import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";

// Proposal tracker: ONE row per proposal, keyed by Proposal ID (column A).
// "generated" appends the row (or refreshes it if regenerated); "sent" updates
// Status + Sent At on the existing row. No-ops silently when not configured,
// so generate/send never fail because of logging.
//
// Env vars:
//   GOOGLE_SERVICE_ACCOUNT_KEY — base64-encoded service-account JSON
//   PROPOSAL_LOG_SHEET_ID      — spreadsheet ID (share the sheet with the service account email)

export const SHEET_HEADERS = [
  "Proposal ID",    // A — auto
  "Proposal Date",  // B — auto
  "Prepared By",    // C — auto (from form)
  "Client",         // D — signer (person)
  "Company",        // E — client/company name
  "Client Email",   // F — auto
  "Event",          // G — event type(s)
  "Event Date(s)",  // H — auto
  "Guest Count",    // I — auto
  "Venue",          // J — auto (from form)
  "Budget",         // K — auto
  "Fee",            // L — auto (Proposal Value)
  "Status",         // M — auto Generated/Sent, then manual
  "Sent At",        // N — auto on send
  "Next Follow-up", // O — manual
  "Notes",          // P — manual
] as const;

const TAB = "Proposals";

type EventLike = { date?: string; eventTypes?: string[]; guestCount?: string };

export interface ProposalPayload {
  proposal_id?: string;
  prepared_by?: string;
  client_name?: string;
  signer_name?: string;
  client_email?: string;
  venue?: string;
  budget_low?: string;
  budget_high?: string;
  service_fee?: string;
  events?: EventLike[];
}

function getSheetsClient(): { sheets: sheets_v4.Sheets; sheetId: string } | null {
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

function nowET(): string {
  return new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
}

// Neutralize spreadsheet formula injection: a leading = + or @ would execute
// as a formula under USER_ENTERED input. Prefix with ' so Sheets stores text.
function safeCell(v: string): string {
  return /^[=+@]/.test(v) ? `'${v}` : v;
}

function buildRow(p: ProposalPayload, status: string, sentAt: string): string[] {
  const events = p.events ?? [];
  return [
    p.proposal_id ?? "",
    nowET(),
    safeCell(p.prepared_by ?? ""),
    safeCell(p.signer_name ?? ""),
    safeCell(p.client_name ?? ""),
    safeCell(p.client_email ?? ""),
    safeCell([...new Set(events.flatMap((e) => e.eventTypes ?? []))].join(", ")),
    safeCell(events.map((e) => e.date ?? "").filter(Boolean).join(", ")),
    safeCell(events.map((e) => e.guestCount ?? "").filter(Boolean).join(", ")),
    safeCell(p.venue ?? ""),
    safeCell([p.budget_low, p.budget_high].filter(Boolean).join(" to ")),
    safeCell(p.service_fee ?? ""),
    status,
    sentAt,
  ];
}

async function findRowById(sheets: sheets_v4.Sheets, sheetId: string, proposalId: string): Promise<number | null> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${TAB}!A:A`,
  });
  const rows = res.data.values ?? [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === proposalId) return i + 1; // 1-indexed sheet row
  }
  return null;
}

export async function logProposal(action: "generated" | "sent", p: ProposalPayload): Promise<void> {
  try {
    const client = getSheetsClient();
    if (!client || !p.proposal_id) return;
    const { sheets, sheetId } = client;

    const existingRow = await findRowById(sheets, sheetId, p.proposal_id);

    if (action === "sent" && existingRow) {
      // Update Status (M) + Sent At (N) only — preserve manual columns
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${TAB}!M${existingRow}:N${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Sent", nowET()]] },
      });
      return;
    }

    const status = action === "sent" ? "Sent" : "Generated";
    const sentAt = action === "sent" ? nowET() : "";
    const row = buildRow(p, status, sentAt);

    if (existingRow) {
      // Regenerated proposal: refresh auto columns A–N, keep manual O–P
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${TAB}!A${existingRow}:N${existingRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: sheetId,
        range: `${TAB}!A:P`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
      });
    }
  } catch (err) {
    // Logging must never break the main flow
    console.error("Proposal log failed:", err instanceof Error ? err.message : err);
  }
}
