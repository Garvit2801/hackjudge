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

Score each parameter 1–10. Return ONLY valid JSON, no markdown fences:

{
  "inferred_purpose": "<paragraph describing what this project actually does based on code evidence>",
  "confidence": "high|medium|low",
  "analysis_mode": "readme_assisted|code_only|description_assisted",
  "scores": {
    "innovation":          { "score": <1-10>, "reasoning": "<2-3 sentences citing specific evidence>" },
    "technical_execution": { "score": <1-10>, "reasoning": "<2-3 sentences citing specific evidence>" },
    "completeness":        { "score": <1-10>, "reasoning": "<2-3 sentences citing specific evidence>" },
    "ps_alignment":        { "score": <1-10>, "reasoning": "<2-3 sentences citing specific evidence>" },
    "code_quality":        { "score": <1-10>, "reasoning": "<2-3 sentences citing specific evidence>" }
  },
  "overall_feedback": "<3-4 sentences of holistic evaluation>",
  "strengths":  ["<strength 1>", "<strength 2>", "<strength 3>"],
  "weaknesses": ["<weakness 1>", "<weakness 2>"]
}

RULES: Base scores on code evidence not README claims. Empty functions/TODOs = incomplete. Single midnight commit = rushed.`;
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
    generationConfig: { temperature: 0.25, maxOutputTokens: 8192, topP: 0.8 },
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
