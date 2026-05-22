// ─────────────────────────────────────────────────────────────────────────────
//  Gemini Client — calls Gemini API directly from the browser
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
];

const WEIGHTS = {
  innovation: 0.25, technical_execution: 0.30,
  completeness: 0.25, ps_alignment: 0.15, code_quality: 0.05,
};

function buildPrompt(repo, problemStatement, projectDescription = "") {
  const readme    = (repo.readme || "").trim();
  const hasReadme = readme.length > 60;

  const mode = hasReadme
    ? "A README is present. Use it as primary signal but verify against code."
    : projectDescription.trim()
      ? `No README. Team description: "${projectDescription}". Use code evidence.`
      : "No README or description. Infer purpose entirely from code, filenames, imports, commits.";

  const code = (repo.codeFiles || []).map(f => "=== FILE: " + f.path + " ===\n" + f.content).join("\n\n");
  const deps  = Object.entries(repo.deps || {}).map(([f, c]) => f + ":\n" + c).join("\n\n");
  const commits = (repo.commits || []).slice(0, 12).map(m => "- " + m).join("\n");
  const tree  = (repo.files || []).slice(0, 60).join("\n");

  return `You are a senior software engineer acting as a hackathon judge. Evaluate this GitHub project against the problem statement below.

PROBLEM STATEMENT:
${problemStatement}

ANALYSIS MODE: ${mode}

REPO: ${repo.owner}/${repo.repo} | Language: ${repo.meta?.language || "Unknown"}

README:
${hasReadme ? readme : "[No README found]"}

FILE STRUCTURE:
${tree || "[Empty repo]"}

DEPENDENCIES:
${deps || "[None found]"}

RECENT COMMITS:
${commits || "[None found]"}

SOURCE CODE:
${code || "[No code accessible]"}

SCORING RUBRIC — apply these exact criteria for each score:

INNOVATION & CREATIVITY (weight 25%):
10 = Completely novel concept not seen in common hackathon projects, solves a hard real problem in a unique way
8-9 = Creative idea with clear differentiation, goes significantly beyond tutorials
6-7 = Some originality, not entirely generic but builds on common patterns
4-5 = Standard hackathon idea (todo app, weather app, basic chatbot) with minor twist
2-3 = Direct copy of tutorial or boilerplate with minimal changes
1 = No original thinking whatsoever

TECHNICAL EXECUTION (weight 30%):
10 = Production-quality architecture, clean separation of concerns, sophisticated implementation
8-9 = Well-structured code, appropriate design patterns, good use of the tech stack
6-7 = Functional code, some structure, minor issues but works
4-5 = Messy or inconsistent code, some bad practices, partially works
2-3 = Mostly broken, incorrect tool choices, poor implementation
1 = Non-functional or trivially minimal code

PROJECT COMPLETENESS (weight 25%):
10 = Fully working end-to-end, all core features implemented, deployable demo exists
8-9 = Most features work, minor gaps, clear entry point and runnable
6-7 = Core feature works but secondary features missing or stubbed
4-5 = Partially implemented, significant features missing
2-3 = Mostly scaffolding, little real implementation
1 = Empty or near-empty repo, nothing works

PROBLEM STATEMENT ALIGNMENT (weight 15%):
10 = Solution directly and completely addresses every requirement in the problem statement
8-9 = Strong alignment, addresses most requirements with clear connection
6-7 = Partially aligned, addresses the main problem but misses some requirements
4-5 = Loosely connected, addresses the general domain but not the specific problem
2-3 = Minimal connection to the problem statement
1 = No meaningful connection

CODE QUALITY (weight 5%):
10 = Tests present, linting configured, no hardcoded secrets, proper .gitignore, license
8-9 = Good practices followed, minor gaps
6-7 = Some good practices, some neglected
4-5 = Poor practices throughout
1-3 = No practices followed, potential security issues

CRITICAL SCORING RULES:
- Count the actual number of implemented files and functions before scoring completeness
- Check if functions have real logic or are just stubs (pass/TODO/return null)
- Compare the problem statement requirements word by word against what is built
- Give the SAME score if you see the SAME evidence — be consistent
- Do not round up out of generosity — score what you see, not what you imagine
- A project with 3 real files scores lower than one with 10 real files, all else equal

Return ONLY valid JSON, no markdown fences:

{
  "inferred_purpose": "<paragraph describing what this project actually does based on code evidence>",
  "confidence": "high|medium|low",
  "analysis_mode": "readme_assisted|code_only|description_assisted",
  "scores": {
    "innovation":          { "score": <integer 1-10>, "reasoning": "<cite 2-3 specific files/functions as evidence>" },
    "technical_execution": { "score": <integer 1-10>, "reasoning": "<cite 2-3 specific files/functions as evidence>" },
    "completeness":        { "score": <integer 1-10>, "reasoning": "<cite 2-3 specific files/functions as evidence>" },
    "ps_alignment":        { "score": <integer 1-10>, "reasoning": "<cite specific requirements met or missed>" },
    "code_quality":        { "score": <integer 1-10>, "reasoning": "<cite specific files/configs as evidence>" }
  },
  "overall_feedback": "<3-4 sentences of holistic evaluation>",
  "strengths":  ["<specific strength with file/feature evidence>", "<specific strength>", "<specific strength>"],
  "weaknesses": ["<specific weakness with evidence>", "<specific weakness>"]
}`;
}

function extractJson(text) {
  text = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
  const start = text.indexOf("{");
  if (start === -1) return text;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inStr) { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (ch === "{") depth++; else if (ch === "}") { depth--; if (depth === 0) return text.slice(start, i + 1); } }
  }
  return repairJson(text.slice(start));
}

function repairJson(raw) {
  let inStr = false, esc = false, suffix = "";
  for (const ch of raw) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
  }
  if (inStr) suffix += ' [truncated]"';
  let braces = 0, brackets = 0; inStr = false; esc = false;
  for (const ch of raw + suffix) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (!inStr) { if (ch==="{")braces++; else if(ch==="}") braces=Math.max(0,braces-1); else if(ch==="[")brackets++; else if(ch==="]") brackets=Math.max(0,brackets-1); }
  }
  return raw + suffix + "]".repeat(brackets) + "}".repeat(braces);
}

async function analyzeWithGemini(repo, problemStatement, apiKey, projectDescription = "", onProgress = null) {
  const prompt  = buildPrompt(repo, problemStatement, projectDescription);
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 8192, topP: 1.0 },
  };

  let lastError = null;
  const BASE = "https://generativelanguage.googleapis.com/v1beta/models/";

  for (const model of GEMINI_MODELS) {
    if (onProgress) onProgress("Calling " + model + "…");
    let resp;
    try {
      resp = await fetch(BASE + model + ":generateContent?key=" + apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      lastError = "Network error: " + e.message; continue;
    }

    if (resp.status === 404) { lastError = "Model '" + model + "' not available"; continue; }
    if (resp.status === 429) throw new Error("Rate limit hit. Wait a minute or use a different API key.");
    if (resp.status === 400) { const e = await resp.json(); throw new Error("Bad request: " + (e?.error?.message || "Unknown")); }
    if (resp.status !== 200) { const e = await resp.json(); lastError = "Error " + resp.status + " on " + model + ": " + (e?.error?.message || ""); continue; }

    const data = await resp.json();
    const cands = data.candidates || [];
    if (!cands.length) { lastError = model + " returned no candidates"; continue; }

    let text = cands[0]?.content?.parts?.[0]?.text || "";
    if (cands[0]?.finishReason === "MAX_TOKENS") text = repairJson(extractJson(text));

    let result;
    try { result = JSON.parse(extractJson(text)); }
    catch (e) { throw new Error("Failed to parse Gemini response: " + e.message + "\nRaw: " + text.slice(0, 400)); }

    // Clamp scores + compute weighted total
    const scores = result.scores || {};
    for (const k of Object.keys(WEIGHTS)) {
      if (!scores[k]) scores[k] = { score: 5, reasoning: "Not provided." };
      scores[k].score = Math.max(1, Math.min(10, parseFloat(scores[k].score) || 5));
    }
    result.scores      = scores;
    result.total_score = parseFloat(Object.entries(WEIGHTS).reduce((s, [k, w]) => s + (scores[k]?.score || 0) * w, 0).toFixed(2));
    return result;
  }

  throw new Error("All Gemini models failed. Last error: " + lastError + ". Check your API key.");
}