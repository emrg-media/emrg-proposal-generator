import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Dashboard edits: update Status (M) and/or Fee (L) for one proposal row by ID.

const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

export async function POST(req: NextRequest) {
  const { id, status, fee } = await req.json();

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Proposal id required." }, { status: 400 });
  }
  if (status !== undefined && !STATUS_OPTIONS.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }
  if (fee !== undefined && (typeof fee !== "string" || fee.length > 40)) {
    return NextResponse.json({ error: "Invalid fee." }, { status: 400 });
  }
  if (status === undefined && fee === undefined) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
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
      return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    }

    const updates: Array<{ range: string; values: string[][] }> = [];
    if (fee !== undefined) {
      // Neutralize formula injection on manual fee input
      const safeFee = /^[=+@]/.test(fee) ? `'${fee}` : fee;
      updates.push({ range: `Proposals!L${rowIndex}`, values: [[safeFee]] });
    }
    if (status !== undefined) {
      updates.push({ range: `Proposals!M${rowIndex}`, values: [[status]] });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data: updates },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
