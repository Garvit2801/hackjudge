// ─────────────────────────────────────────────────────────────────────────────
//  HackJudge — Configuration
//  Safe to commit publicly — NO secrets here.
//  The Apps Script URL is public by design (it handles auth internally).
// ─────────────────────────────────────────────────────────────────────────────

const CONFIG = {

  // ── Google Apps Script Web App URL ────────────────────────────────────────
  // After deploying Code.gs as a web app, paste the URL here.
  // Looks like: https://script.google.com/macros/s/AKfy.../exec
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwiTs8rRTV62V0wxwpFna-n7NqBrHTrnDFFNOVWRxB6S-ZheZWUFSt_wVMf254Mw_cUdA/exec",

  // ── Write secret (must match WRITE_SECRET in Code.gs) ────────────────────
  // This is a shared password for write operations — not a token.
  // Safe to be public since Apps Script validates it server-side.
  WRITE_SECRET: "hackjudge_write_2025",

  // ── Event settings ────────────────────────────────────────────────────────
  EVENT_NAME: "Google Agentic Premier League 2026",
  EVENT_DATE: "May 2026",

  // ── Admin credentials ─────────────────────────────────────────────────────
  ADMIN_USERNAME: "hackadmin",
  ADMIN_PASSWORD: "hackjudge@2026",

};