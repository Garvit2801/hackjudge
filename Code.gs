// ─────────────────────────────────────────────────────────────────────────────
//  HackJudge — Google Apps Script Backend
//  Deploy this as a Web App with:
//    - Execute as: Me
//    - Who has access: Anyone
//
//  This script is the only place that touches Google Sheets.
//  It runs on Google's servers — no tokens exposed to browsers.
// ─────────────────────────────────────────────────────────────────────────────

// ── CONFIG — fill in your Sheet ID ───────────────────────────────────────────
const SHEET_ID     = "YOUR_GOOGLE_SHEET_ID_HERE";
const SHEET_NAME   = "Submissions";
const WRITE_SECRET = "hackjudge_write_2025"; // shared secret for write operations

// ── Column mapping ────────────────────────────────────────────────────────────
const COLS = {
  id:                  1,
  status:              2,
  created_at:          3,
  team_name:           4,
  project_title:       5,
  member_names:        6,
  contact_email:       7,
  track:               8,
  problem_statement:   9,
  github_url:          10,
  project_description: 11,
  total_score:         12,
  scores_json:         13,
  feedback_json:       14,
};

const TOTAL_COLS = 14;

// ── CORS headers ──────────────────────────────────────────────────────────────
function corsHeaders() {
  return ContentService
    .createTextOutput("")
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── GET handler ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const action = e.parameter.action || "all";
    const id     = e.parameter.id || "";

    const sheet = getSheet();

    if (action === "one") {
      // Load single submission by ID
      const row = findRow(sheet, id);
      if (!row) return jsonResponse({ error: "Not found" });
      return jsonResponse(rowToRecord(row));
    }

    if (action === "all") {
      // All scored submissions for leaderboard
      const records = getAllRecords(sheet)
        .filter(r => r.total_score != null)
        .sort((a, b) => b.total_score - a.total_score);
      return jsonResponse(records);
    }

    if (action === "admin") {
      // All submissions regardless of status (for admin panel)
      const records = getAllRecords(sheet)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return jsonResponse(records);
    }

    return jsonResponse({ error: "Unknown action" });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const body   = JSON.parse(e.postData.contents);
    const action = body.action || "save";
    const secret = body.secret || "";

    // Validate write secret
    if (secret !== WRITE_SECRET) {
      return jsonResponse({ error: "Unauthorized" });
    }

    const sheet = getSheet();

    if (action === "save") {
      // Save or update a submission
      const record = body.record;
      if (!record || !record.id) return jsonResponse({ error: "Missing record or id" });

      const existing = findRowIndex(sheet, record.id);

      if (existing > 0) {
        // Update existing row
        writeRow(sheet, existing, record);
      } else {
        // Append new row
        const lastRow = sheet.getLastRow() + 1;
        writeRow(sheet, lastRow, record);
      }
      return jsonResponse({ success: true, id: record.id });
    }

    if (action === "delete") {
      const id  = body.id;
      const idx = findRowIndex(sheet, id);
      if (idx > 0) sheet.deleteRow(idx);
      return jsonResponse({ success: true, deleted: id });
    }

    if (action === "delete_all") {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1);
      }
      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Unknown action" });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── Sheet helpers ─────────────────────────────────────────────────────────────

function getSheet() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    // Create sheet with headers if it doesn't exist
    sheet = ss.insertSheet(SHEET_NAME);
    const headers = [
      "ID", "Status", "Created At", "Team Name", "Project Title",
      "Member Names", "Contact Email", "Track", "Problem Statement",
      "GitHub URL", "Project Description", "Total Score",
      "Scores JSON", "Feedback JSON"
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRow(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) return data[i];
  }
  return null;
}

function findRowIndex(sheet, id) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) return i + 1; // 1-indexed
  }
  return -1;
}

function getAllRecords(sheet) {
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (row[0]) records.push(rowToRecord(row));
  }
  return records;
}

function rowToRecord(row) {
  let scores   = null;
  let feedback = null;

  try { scores   = row[COLS.scores_json   - 1] ? JSON.parse(row[COLS.scores_json   - 1]) : null; } catch {}
  try { feedback = row[COLS.feedback_json - 1] ? JSON.parse(row[COLS.feedback_json - 1]) : null; } catch {}

  return {
    id:                  row[COLS.id                  - 1] || "",
    status:              row[COLS.status              - 1] || "pending",
    created_at:          row[COLS.created_at          - 1] || "",
    team_name:           row[COLS.team_name           - 1] || "",
    project_title:       row[COLS.project_title       - 1] || "",
    member_names:        row[COLS.member_names        - 1] || "",
    contact_email:       row[COLS.contact_email       - 1] || "",
    track:               row[COLS.track               - 1] || "",
    problem_statement:   row[COLS.problem_statement   - 1] || "",
    github_url:          row[COLS.github_url          - 1] || "",
    project_description: row[COLS.project_description - 1] || "",
    total_score:         row[COLS.total_score         - 1] !== "" ? parseFloat(row[COLS.total_score - 1]) : null,
    scores:              scores,
    feedback:            feedback,
  };
}

function writeRow(sheet, rowIndex, record) {
  const row = new Array(TOTAL_COLS).fill("");
  row[COLS.id                  - 1] = record.id                  || "";
  row[COLS.status              - 1] = record.status              || "pending";
  row[COLS.created_at          - 1] = record.created_at          || new Date().toISOString();
  row[COLS.team_name           - 1] = record.team_name           || "";
  row[COLS.project_title       - 1] = record.project_title       || "";
  row[COLS.member_names        - 1] = record.member_names        || "";
  row[COLS.contact_email       - 1] = record.contact_email       || "";
  row[COLS.track               - 1] = record.track               || "";
  row[COLS.problem_statement   - 1] = record.problem_statement   || "";
  row[COLS.github_url          - 1] = record.github_url          || "";
  row[COLS.project_description - 1] = record.project_description || "";
  row[COLS.total_score         - 1] = record.total_score != null  ? record.total_score : "";
  row[COLS.scores_json         - 1] = record.scores   ? JSON.stringify(record.scores)   : "";
  row[COLS.feedback_json       - 1] = record.feedback ? JSON.stringify(record.feedback) : "";

  sheet.getRange(rowIndex, 1, 1, TOTAL_COLS).setValues([row]);
}