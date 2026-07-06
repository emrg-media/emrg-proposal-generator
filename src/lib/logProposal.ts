import { google } from "googleapis";

// Appends one row per proposal action to the log sheet.
// No-ops silently when logging isn't configured, so generate/send never fail because of it.
//
// Env vars:
//   GOOGLE_SERVICE_ACCOUNT_KEY — base64-encoded service-account JSON
//   PROPOSAL_LOG_SHEET_ID      — the spreadsheet ID (share the sheet with the service account email)

export interface ProposalLogEntry {
  action: "generated" | "sent";
  client_name: string;
  signer_name?: string;
  client_email?: string;
  event_types: string;
  event_dates: string;
  guest_counts: string;
  budget: string;
  service_fee: string;
}

export async function logProposal(entry: ProposalLogEntry): Promise<void> {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) return;

  try {
    const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: "A:J",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
          entry.action,
          entry.client_name,
          entry.signer_name ?? "",
          entry.client_email ?? "",
          entry.event_types,
          entry.event_dates,
          entry.guest_counts,
          entry.budget,
          entry.service_fee,
        ]],
      },
    });
  } catch (err) {
    // Logging must never break the main flow
    console.error("Proposal log failed:", err instanceof Error ? err.message : err);
  }
}

type EventLike = { date?: string; eventTypes?: string[]; guestCount?: string };

export function entryFromProposal(
  action: "generated" | "sent",
  data: {
    client_name?: string; signer_name?: string; client_email?: string;
    budget_low?: string; budget_high?: string; service_fee?: string;
    events?: EventLike[];
  },
): ProposalLogEntry {
  const events = data.events ?? [];
  return {
    action,
    client_name: data.client_name ?? "",
    signer_name: data.signer_name,
    client_email: data.client_email,
    event_types: [...new Set(events.flatMap((e) => e.eventTypes ?? []))].join(", "),
    event_dates: events.map((e) => e.date ?? "").filter(Boolean).join(", "),
    guest_counts: events.map((e) => e.guestCount ?? "").filter(Boolean).join(", "),
    budget: [data.budget_low, data.budget_high].filter(Boolean).join(" – "),
    service_fee: data.service_fee ?? "",
  };
}
