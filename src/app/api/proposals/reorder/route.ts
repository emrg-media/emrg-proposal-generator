import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Board drag-and-drop persistence in one request:
//   orderedIds — the full ordered list of a column's proposals; each gets its
//                position written to the Sort column (Q).
//   movedId + newStatus — optionally move one proposal to a new stage (M).

const STATUS_OPTIONS = ["Generated", "Sent", "Viewed", "Negotiating", "Signed", "Lost"];

export async function POST(req: NextRequest) {
  const { orderedIds, movedId, newStatus } = await req.json();

  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== "string")) {
    return NextResponse.json({ error: "orderedIds must be an array of ids." }, { status: 400 });
  }
  if (newStatus !== undefined && !STATUS_OPTIONS.includes(newStatus)) {
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

    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Proposals!A:A" });
    const rows = res.data.values ?? [];
    const rowById = new Map<string, number>();
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0]) rowById.set(rows[i][0], i + 1);
    }

    const data: Array<{ range: string; values: (string | number)[][] }> = [];
    orderedIds.forEach((id, index) => {
      const row = rowById.get(id);
      if (row) data.push({ range: `Proposals!Q${row}`, values: [[index]] });
    });
    if (movedId && newStatus) {
      const row = rowById.get(movedId);
      if (row) data.push({ range: `Proposals!M${row}`, values: [[newStatus]] });
    }

    if (data.length === 0) {
      return NextResponse.json({ error: "No matching rows found." }, { status: 404 });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reorder failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
