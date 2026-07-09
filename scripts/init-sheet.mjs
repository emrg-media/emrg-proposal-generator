// One-time setup for the proposal tracker sheet.
// Renames the first tab to "Proposals", writes headers, freezes row 1,
// styles the header, adds Status dropdown + conditional formatting.
//
// Usage:  node scripts/init-sheet.mjs
// Reads GOOGLE_SERVICE_ACCOUNT_KEY and PROPOSAL_LOG_SHEET_ID from .env.local

import { google } from "googleapis";
import { readFileSync } from "fs";

// Minimal .env.local parser (no dotenv dependency)
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
if (!keyB64 || !sheetId) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_KEY or PROPOSAL_LOG_SHEET_ID in .env.local");
  process.exit(1);
}

const HEADERS = [
  "Proposal ID", "Proposal Date", "Prepared By", "Client", "Company", "Client Email",
  "Event", "Event Date(s)", "Guest Count", "Venue", "Budget", "Fee",
  "Status", "Sent At", "Next Follow-up", "Notes",
];
const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
const firstSheet = meta.data.sheets[0].properties;
const sid = firstSheet.sheetId;
console.log(`Configuring tab "${firstSheet.title}" (id ${sid}) → "Proposals"`);

// Headers
await sheets.spreadsheets.values.update({
  spreadsheetId: sheetId,
  range: `${firstSheet.title}!A1:P1`,
  valueInputOption: "RAW",
  requestBody: { values: [HEADERS] },
});

const requests = [
  // Rename tab
  { updateSheetProperties: { properties: { sheetId: sid, title: "Proposals" }, fields: "title" } },
  // Freeze header row
  { updateSheetProperties: { properties: { sheetId: sid, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
  // Header style: EMRG black bg, white bold text
  {
    repeatCell: {
      range: { sheetId: sid, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 16 },
      cell: {
        userEnteredFormat: {
          backgroundColor: { red: 0.05, green: 0.05, blue: 0.05 },
          textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true, fontSize: 10 },
          horizontalAlignment: "LEFT",
        },
      },
      fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
    },
  },
  // Status dropdown (column M, rows 2+)
  {
    setDataValidation: {
      range: { sheetId: sid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 12, endColumnIndex: 13 },
      rule: {
        condition: { type: "ONE_OF_LIST", values: STATUS_OPTIONS.map((v) => ({ userEnteredValue: v })) },
        showCustomUi: true,
        strict: false,
      },
    },
  },
  // Conditional: Signed rows → green Status cell
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 12, endColumnIndex: 13 }],
        booleanRule: {
          condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Signed" }] },
          format: { backgroundColor: { red: 0.85, green: 0.94, blue: 0.85 } },
        },
      },
      index: 0,
    },
  },
  // Conditional: Lost rows → grey Status cell
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 12, endColumnIndex: 13 }],
        booleanRule: {
          condition: { type: "TEXT_EQ", values: [{ userEnteredValue: "Lost" }] },
          format: { backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }, textFormat: { strikethrough: true } },
        },
      },
      index: 1,
    },
  },
  // Conditional: overdue follow-up (column O date < today) → red cell
  {
    addConditionalFormatRule: {
      rule: {
        ranges: [{ sheetId: sid, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 14, endColumnIndex: 15 }],
        booleanRule: {
          condition: { type: "DATE_BEFORE", values: [{ relativeDate: "TODAY" }] },
          format: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 } },
        },
      },
      index: 2,
    },
  },
  // Column widths
  { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
  { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 1, endIndex: 2 }, properties: { pixelSize: 150 }, fields: "pixelSize" } },
  { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 5, endIndex: 6 }, properties: { pixelSize: 190 }, fields: "pixelSize" } },
  { updateDimensionProperties: { range: { sheetId: sid, dimension: "COLUMNS", startIndex: 15, endIndex: 16 }, properties: { pixelSize: 260 }, fields: "pixelSize" } },
];

await sheets.spreadsheets.batchUpdate({ spreadsheetId: sheetId, requestBody: { requests } });
console.log("✓ Sheet configured: headers, frozen row, header style, Status dropdown, conditional formatting");
