import "server-only";
import { google } from "googleapis";
import { buildExport } from "./opportunityExport";

// One-way mirror of the database into a Google Sheet tab.
//
// Postgres is the source of truth; this exists purely so Mario keeps the
// spreadsheet he is used to. Because it rewrites the whole tab from scratch
// every run there are no row-index writes and no races — the failure mode that
// made the original single-sheet tracker unsafe with five people editing.
//
// Anything typed into this tab will be overwritten on the next run, which is
// why the tab is named to say so.

const TAB = "Opportunities (read-only)";

function sheetsClient(): { sheets: ReturnType<typeof google.sheets>; sheetId: string } | null {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) return null;

  const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId };
}

// A cell starting = + or @ is executed as a formula under USER_ENTERED.
function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+@]/.test(s) ? `'${s}` : s;
}

export interface MirrorResult {
  ok: boolean;
  rows?: number;
  reason?: string;
}

export async function mirrorToSheet(): Promise<MirrorResult> {
  const client = sheetsClient();
  if (!client) {
    return { ok: false, reason: "Sheet mirror is not configured (GOOGLE_SERVICE_ACCOUNT_KEY / PROPOSAL_LOG_SHEET_ID)." };
  }
  const { sheets, sheetId } = client;
  const { headers, rows } = await buildExport();

  // Create the tab on first run.
  const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
  }

  // Clear first: a shrinking dataset must not leave stale rows behind.
  await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: TAB });

  const note = [
    `Mirrored from the EMRG Events Revenue System at ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })} ET.`,
    "This tab is rebuilt automatically, so edits here are overwritten. Edit in the app instead.",
  ];

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${TAB}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [note, [], headers.map(safeCell), ...rows.map((r) => r.map(safeCell))],
    },
  });

  return { ok: true, rows: rows.length };
}
