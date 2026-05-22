// ─────────────────────────────────────────────────────────────────────────────
//  Sheets Client
//  All data operations go through Google Apps Script → Google Sheets.
//  No GitHub token needed. Works on every device, every browser.
// ─────────────────────────────────────────────────────────────────────────────

// ── Data operations ───────────────────────────────────────────────────────────

async function saveSubmission(id, record) {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("YOUR_SCRIPT_ID")) {
    throw new Error("APPS_SCRIPT_URL not set in config.js. Deploy Code.gs first.");
  }

  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // text/plain avoids CORS preflight
    body: JSON.stringify({
      action: "save",
      secret: CONFIG.WRITE_SECRET,
      record: record,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error("Save failed: " + data.error);
  return data;
}

async function loadSubmission(id) {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("YOUR_SCRIPT_ID")) {
    throw new Error("APPS_SCRIPT_URL not set in config.js.");
  }

  const url = CONFIG.APPS_SCRIPT_URL + "?action=one&id=" + encodeURIComponent(id);
  const res  = await fetch(url);
  const data = await res.json();

  if (data.error === "Not found") return null;
  if (data.error) throw new Error("Load failed: " + data.error);
  return data;
}

async function loadAllSubmissions() {
  if (!CONFIG.APPS_SCRIPT_URL || CONFIG.APPS_SCRIPT_URL.includes("YOUR_SCRIPT_ID")) {
    return [];
  }
  const url  = CONFIG.APPS_SCRIPT_URL + "?action=all";
  const res  = await fetch(url);
  const data = await res.json();
  if (Array.isArray(data)) return data;
  return [];
}

async function loadAllSubmissionsAdmin() {
  const url  = CONFIG.APPS_SCRIPT_URL + "?action=admin";
  const res  = await fetch(url);
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map(r => ({ record: r, sha: r.id })); // sha = id for compatibility
}

async function deleteSubmission(id) {
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "delete",
      secret: CONFIG.WRITE_SECRET,
      id:     id,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error("Delete failed: " + data.error);
  return data;
}

async function deleteAllSubmissions() {
  const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      action: "delete_all",
      secret: CONFIG.WRITE_SECRET,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error("Delete all failed: " + data.error);
  return data;
}

// ── GitHub repo analysis (unchanged — analyses submitted repos, not our data) ─

const PRIORITY_ENTRY = ["main.py","app.py","server.py","run.py","index.js","app.js","server.js","index.ts","app.ts","App.jsx","App.tsx","index.jsx","index.tsx","main.go","main.java","Main.java"];
const PRIORITY_DIRS  = new Set(["src","api","routes","controllers","services","models","core","lib","app"]);
const SKIP_DIRS      = new Set(["node_modules",".git","dist","build","__pycache__",".next","venv","env",".venv","coverage",".cache","tmp","vendor"]);
const SKIP_EXTS      = new Set([".png",".jpg",".jpeg",".gif",".ico",".svg",".pdf",".zip",".tar",".gz",".min.js",".min.css",".map",".lock",".woff",".woff2",".ttf",".eot",".bin"]);
const CODE_EXTS      = new Set([".py",".js",".ts",".jsx",".tsx",".go",".java",".rs",".php",".rb",".cpp",".c",".cs",".swift",".kt",".vue",".html",".css",".scss",".sh",".yaml",".yml",".toml"]);
const DEP_FILES      = ["package.json","requirements.txt","pyproject.toml","Pipfile","go.mod","pom.xml","build.gradle","Cargo.toml","composer.json","Gemfile"];

function parseGithubUrl(url) {
  url = url.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const m = url.match(/github\.com\/([^\/\s]+)\/([^\/\s]+)/);
  if (!m) throw new Error("Invalid GitHub URL: " + url);
  return { owner: m[1], repo: m[2] };
}

async function ghFetch(path) {
  const r = await fetch("https://api.github.com" + path, {
    headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "HackJudge/1.0" }
  });
  return { status: r.status, data: r.status === 204 ? null : await r.json() };
}

function b64decode(str) { try { return atob(str.replace(/\n/g, "")); } catch { return ""; } }

async function fetchRepoData(githubUrl) {
  const { owner, repo } = parseGithubUrl(githubUrl);
  const base = "/repos/" + owner + "/" + repo;

  const { status: ms, data: meta } = await ghFetch(base);
  if (ms === 404) throw new Error("Repository '" + owner + "/" + repo + "' not found. Make sure it is public.");
  if (ms === 403) throw new Error("GitHub API rate limit reached. Wait a minute and try again.");
  if (ms !== 200) throw new Error("GitHub API error " + ms);
  if (meta.size === 0) throw new Error("Repository is empty — nothing to evaluate.");

  const branch = meta.default_branch || "main";
  let allFiles = await getFileTree(base, branch);
  if (!allFiles.length) allFiles = await getRootContents(base, branch);

  const readme = await getReadme(base, allFiles);

  const { data: cd } = await ghFetch(base + "/commits?sha=" + branch + "&per_page=20");
  const commits = Array.isArray(cd) ? cd.map(c => (c?.commit?.message || "").split("\n")[0]).filter(Boolean) : [];

  const deps      = await getDependencies(base, allFiles);
  const codeFiles = await getKeyFiles(base, allFiles);

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