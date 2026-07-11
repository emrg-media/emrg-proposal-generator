import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Dashboard edits: update any editable columns for one proposal row by ID.
// Accepts { id, fields: { preparedBy, client, company, email, event, eventDates,
// guests, venue, budget, fee, status, followUp, notes } } — all optional.
// Also accepts legacy { id, status, fee } shape.

const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

// field → sheet column (A=ID and B=Proposal Date and N=Sent At are system-owned)
const COLUMN_MAP: Record<string, string> = {
  preparedBy: "C",
  client: "D",
  company: "E",
  email: "F",
  event: "G",
  eventDates: "H",
  guests: "I",
  venue: "J",
  budget: "K",
  fee: "L",
  status: "M",
  followUp: "O",
  notes: "P",
};

function safeCell(v: string): string {
  return /^[=+@]/.test(v) ? `'${v}` : v;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const id = body.id;
  const fields: Record<string, unknown> = { ...(body.fields ?? {}) };
  if (body.status !== undefined) fields.status = body.status;
  if (body.fee !== undefined) fields.fee = body.fee;

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Proposal id required." }, { status: 400 });
  }

  const entries = Object.entries(fields).filter(([k]) => COLUMN_MAP[k]);
  if (entries.length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  for (const [k, v] of entries) {
    if (typeof v !== "string" || v.length > 500) {
      return NextResponse.json({ error: `Invalid value for ${k}.` }, { status: 400 });
    }
  }
  if (fields.status !== undefined && !STATUS_OPTIONS.includes(fields.status as string)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) {
    return NextResponse.json({ error: "Tracker is not configured." }, { status: 500 });
  }

  try {
    const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const ids = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Proposals!A:A" });
    const rows = ids.data.values ?? [];
    let rowIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === id) { rowIndex = i + 1; break; }
    }
    if (rowIndex === -1) {
      return NextResponse.json({ error: "Proposal not found. It may have been removed, so refresh the dashboard." }, { status: 404 });
    }

    const data = entries.map(([k, v]) => ({
      range: `Proposals!${COLUMN_MAP[k]}${rowIndex}`,
      values: [[k === "status" ? (v as string) : safeCell(v as string)]],
    }));

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
