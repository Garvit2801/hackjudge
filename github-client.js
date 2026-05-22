// ─────────────────────────────────────────────────────────────────────────────
//  GitHub Client
//  1. Analyse submitted GitHub repos (public, no auth)
//  2. Read/write submission JSON files to the repo
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_ENTRY = ["main.py","app.py","server.py","run.py","index.js","app.js","server.js","index.ts","app.ts","App.jsx","App.tsx","index.jsx","index.tsx","main.go","main.java","Main.java"];
const PRIORITY_DIRS  = new Set(["src","api","routes","controllers","services","models","core","lib","app"]);
const SKIP_DIRS      = new Set(["node_modules",".git","dist","build","__pycache__",".next","venv","env",".venv","coverage",".cache","tmp","vendor"]);
const SKIP_EXTS      = new Set([".png",".jpg",".jpeg",".gif",".ico",".svg",".pdf",".zip",".tar",".gz",".min.js",".min.css",".map",".lock",".woff",".woff2",".ttf",".eot",".bin"]);
const CODE_EXTS      = new Set([".py",".js",".ts",".jsx",".tsx",".go",".java",".rs",".php",".rb",".cpp",".c",".cs",".swift",".kt",".vue",".html",".css",".scss",".sh",".yaml",".yml",".toml"]);
const DEP_FILES      = ["package.json","requirements.txt","pyproject.toml","Pipfile","go.mod","pom.xml","build.gradle","Cargo.toml","composer.json","Gemfile"];

// ── Config validation — called once on page load ──────────────────────────────
function validateConfig() {
  const errors = [];
  if (!CONFIG.GITHUB_OWNER || CONFIG.GITHUB_OWNER === "your-username")
    errors.push("GITHUB_OWNER not set in config.js");
  if (!CONFIG.GITHUB_TOKEN || CONFIG.GITHUB_TOKEN.includes("xxxx"))
    errors.push("GITHUB_TOKEN not set in config.js");
  if (!CONFIG.GITHUB_DATA_REPO)
    errors.push("GITHUB_DATA_REPO not set in config.js");
  if (errors.length) {
    console.error("HackJudge config errors:\n" + errors.join("\n"));
    return false;
  }
  return true;
}

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function ghFetch(path, token = null) {
  const h = { "Accept": "application/vnd.github.v3+json", "User-Agent": "HackJudge/1.0" };
  if (token) h["Authorization"] = "token " + token;
  const r = await fetch("https://api.github.com" + path, { headers: h });
  const data = r.status === 204 ? null : await r.json();
  return { status: r.status, data };
}

async function ghPut(path, body, token) {
  const r = await fetch("https://api.github.com" + path, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": "token " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.message || "Unknown error";
    if (r.status === 401) throw new Error("GitHub token is invalid or expired. Update GITHUB_TOKEN in config.js");
    if (r.status === 403) throw new Error("GitHub token doesn't have write permission. Regenerate with 'repo' scope.");
    if (r.status === 404) throw new Error("Repo not found: " + CONFIG.GITHUB_OWNER + "/" + CONFIG.GITHUB_DATA_REPO + ". Check GITHUB_DATA_REPO in config.js");
    if (r.status === 422) throw new Error("GitHub API error 422: " + msg + ". The submissions/ folder may not exist — create submissions/.gitkeep in your repo.");
    throw new Error("GitHub write failed " + r.status + ": " + msg);
  }
  return { status: r.status, data };
}

async function ghDelete(path, sha, token) {
  const r = await fetch("https://api.github.com" + path, {
    method: "DELETE",
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "Authorization": "token " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message: "Delete submission", sha }),
  });
  return r.status;
}

function b64decode(str) { try { return atob(str.replace(/\n/g, "")); } catch { return ""; } }
function toB64(str)     { return btoa(unescape(encodeURIComponent(str))); }
function fromB64(str)   { return decodeURIComponent(escape(atob(str.replace(/\n/g, "")))); }

// ── DB paths ──────────────────────────────────────────────────────────────────
// All submissions stored in /submissions/ folder of the data repo
const DB = {
  base: () => "/repos/" + CONFIG.GITHUB_OWNER + "/" + CONFIG.GITHUB_DATA_REPO + "/contents/submissions",
  tok:  () => CONFIG.GITHUB_TOKEN,
};

// ── Data read/write ───────────────────────────────────────────────────────────

async function saveSubmission(id, record) {
  if (!validateConfig()) throw new Error("config.js is not filled in correctly. Check the browser console for details.");

  const path = DB.base() + "/" + id + ".json";
  const tok  = DB.tok();

  // Check if file already exists (need its SHA to update)
  const { status: getStatus, data: existing } = await ghFetch(path, tok);
  const sha = getStatus === 200 ? existing.sha : undefined;

  await ghPut(path, {
    message: (sha ? "Update" : "Add") + " submission " + id,
    content: toB64(JSON.stringify(record, null, 2)),
    ...(sha ? { sha } : {}),
  }, tok);
}

async function loadSubmission(id) {
  // Try with token first (handles private repos and avoids rate limits)
  const tok = DB.tok();
  const { status, data } = await ghFetch(DB.base() + "/" + id + ".json", tok || null);

  if (status === 401) throw new Error("GitHub token is invalid or expired. Update GITHUB_TOKEN in config.js and push again.");
  if (status === 404) return null;
  if (status !== 200) throw new Error("Failed to load submission: HTTP " + status);

  try { return JSON.parse(fromB64(data.content)); }
  catch (e) { throw new Error("Failed to parse submission data: " + e.message); }
}

async function loadAllSubmissions() {
  const tok = DB.tok();
  const { status, data } = await ghFetch(DB.base(), tok || null);
  if (status !== 200) return [];

  const files = (Array.isArray(data) ? data : []).filter(f => f.name.endsWith(".json"));
  const results = await Promise.all(files.map(async f => {
    const { status: s, data: d } = await ghFetch(DB.base() + "/" + f.name, tok || null);
    if (s !== 200) return null;
    try { return JSON.parse(fromB64(d.content)); } catch { return null; }
  }));
  return results
    .filter(r => r && r.total_score != null)
    .sort((a, b) => b.total_score - a.total_score);
}

async function loadAllSubmissionsAdmin() {
  const tok = DB.tok();
  const { status, data } = await ghFetch(DB.base(), tok);
  if (status !== 200) return [];

  const files = (Array.isArray(data) ? data : []).filter(f => f.name.endsWith(".json"));
  const results = await Promise.all(files.map(async f => {
    const { status: s, data: d } = await ghFetch(DB.base() + "/" + f.name, tok);
    if (s !== 200) return null;
    try { return { record: JSON.parse(fromB64(d.content)), sha: d.sha }; } catch { return null; }
  }));
  return results
    .filter(Boolean)
    .sort((a, b) => new Date(b.record.created_at) - new Date(a.record.created_at));
}

async function deleteSubmission(id, sha) {
  return await ghDelete(DB.base() + "/" + id + ".json", sha, DB.tok());
}

// ── Repo analysis (for evaluating submitted GitHub repos) ─────────────────────

function parseGithubUrl(url) {
  url = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m = url.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/);
  if (!m) throw new Error("Invalid GitHub URL: " + url);
  return { owner: m[1], repo: m[2] };
}

async function fetchRepoData(githubUrl) {
  const { owner, repo } = parseGithubUrl(githubUrl);
  const base = "/repos/" + owner + "/" + repo;

  const { status: ms, data: meta } = await ghFetch(base);
  if (ms === 404) throw new Error("Repository '" + owner + "/" + repo + "' not found. Make sure it is public.");
  if (ms === 403) throw new Error("GitHub API rate limit reached. Wait a minute and try again.");
  if (ms !== 200) throw new Error("GitHub API error " + ms);
  if (meta.size === 0) throw new Error("Repository '" + owner + "/" + repo + "' is empty — nothing to evaluate.");

  const branch = meta.default_branch || "main";
  let allFiles = await getFileTree(base, branch);
  if (!allFiles.length) allFiles = await getRootContents(base, branch);

  const readme  = await getReadme(base, allFiles);
  const { data: cd } = await ghFetch(base + "/commits?sha=" + branch + "&per_page=20");
  const commits = Array.isArray(cd) ? cd.map(c => (c?.commit?.message || "").split("\n")[0]).filter(Boolean) : [];
  const deps     = await getDependencies(base, allFiles);
  const codeFiles= await getKeyFiles(base, allFiles);

  return {
    owner, repo, branch,
    meta: { description: meta.description || "", language: meta.language || "Unknown", topics: meta.topics || [] },
    files: allFiles.slice(0, 120),
    readme, commits, deps, codeFiles,
  };
}

async function getFileTree(base, branch) {
  for (const b of [...new Set([branch, "main", "master"])]) {
    const { status, data } = await ghFetch(base + "/git/trees/" + b + "?recursive=1");
    if (status !== 200) continue;
    const f = (data.tree || []).filter(x => x.type === "blob").map(x => x.path);
    if (f.length) return f;
  }
  return [];
}

async function getRootContents(base, branch) {
  const files = [];
  const { status, data } = await ghFetch(base + "/contents/?ref=" + branch);
  if (status !== 200 || !Array.isArray(data)) return files;
  for (const item of data) {
    if (item.type === "file") { files.push(item.path); continue; }
    if (item.type === "dir") {
      const { status: s2, data: d2 } = await ghFetch(base + "/contents/" + item.path + "?ref=" + branch);
      if (s2 === 200 && Array.isArray(d2)) d2.filter(f => f.type === "file").forEach(f => files.push(f.path));
    }
  }
  return files;
}

async function getReadme(base, files) {
  const { status, data } = await ghFetch(base + "/readme");
  if (status === 200 && data?.content) return b64decode(data.content).slice(0, 8000);
  const c = files.find(p => ["readme.md","readme.txt","readme.rst","readme"].includes(p.toLowerCase()));
  if (!c) return "";
  const { status: s2, data: d2 } = await ghFetch(base + "/contents/" + c);
  return s2 === 200 && d2?.content ? b64decode(d2.content).slice(0, 8000) : "";
}

async function getDependencies(base, files) {
  const result = {};
  const lc = Object.fromEntries(files.map(p => [p.toLowerCase(), p]));
  for (const df of DEP_FILES) {
    const actual = lc[df.toLowerCase()];
    if (!actual) continue;
    const { status, data } = await ghFetch(base + "/contents/" + actual);
    if (status === 200 && data?.content) result[df] = b64decode(data.content).slice(0, 3000);
  }
  return result;
}

async function getKeyFiles(base, files) {
  function skip(p) {
    return p.split("/").some(x => SKIP_DIRS.has(x)) ||
      (p.includes(".") && SKIP_EXTS.has("." + p.split(".").pop().toLowerCase()));
  }
  function ext(p) { return p.includes(".") ? "." + p.split(".").pop().toLowerCase() : ""; }

  const sel = [];
  for (const ep of PRIORITY_ENTRY) {
    const f = files.find(p => !skip(p) && p.split("/").pop() === ep && !sel.includes(p));
    if (f) { sel.push(f); if (sel.length >= 3) break; }
  }
  for (const p of files) {
    if (sel.length >= 6) break;
    if (!skip(p) && !sel.includes(p) && PRIORITY_DIRS.has(p.split("/")[0]) && CODE_EXTS.has(ext(p))) sel.push(p);
  }
  for (const p of files) {
    if (sel.length >= 9) break;
    if (!skip(p) && !sel.includes(p) && CODE_EXTS.has(ext(p))) sel.push(p);
  }

  const results = await Promise.all(sel.slice(0, 9).map(async path => {
    const { status, data } = await ghFetch(base + "/contents/" + path);
    return (status === 200 && data?.content) ? { path, content: b64decode(data.content).slice(0, 4000) } : null;
  }));
  return results.filter(Boolean);
}
// Testing