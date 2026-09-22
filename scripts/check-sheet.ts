// Read-only: confirm the service account can reach the spreadsheet, and report
// what is in it. Deliberately does NOT write — the local database holds demo
// records and those must not land in EMRG's live sheet.
import { google } from "googleapis";

const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
if (!keyB64 || !sheetId) { console.error("Sheet credentials not configured."); process.exit(1); }

const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
const auth = new google.auth.GoogleAuth({
  credentials, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

async function main() {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  console.log(`\n  Spreadsheet: ${meta.data.properties?.title}`);
  console.log(`  Service account: ${credentials.client_email}`);
  console.log(`  Tabs: ${meta.data.sheets?.map((s) => s.properties?.title).join(", ")}`);
  
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: "Proposals!A2:Q",
  });
  const rows = (res.data.values ?? []).filter((r) => r[0]);
  console.log(`  Rows in the existing "Proposals" tab: ${rows.length}`);
  if (rows.length) {
    console.log(`  Oldest: ${rows[0][1] ?? "?"}  Newest: ${rows[rows.length - 1][1] ?? "?"}`);
  }
  console.log("\n  Credentials work. No write performed.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
