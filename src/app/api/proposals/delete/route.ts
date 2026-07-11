import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

// Delete one proposal row from the tracker by ID.

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Proposal id required." }, { status: 400 });
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

    // Resolve the numeric sheetId of the Proposals tab
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    const tab = meta.data.sheets?.find((s) => s.properties?.title === "Proposals");
    const gid = tab?.properties?.sheetId;
    if (gid === undefined || gid === null) {
      return NextResponse.json({ error: "Proposals tab not found." }, { status: 500 });
    }

    // Find the row (0-based grid index) by ID
    const col = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: "Proposals!A:A" });
    const rows = col.data.values ?? [];
    let gridIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][0] === id) { gridIndex = i; break; }
    }
    if (gridIndex === -1) {
      return NextResponse.json({ error: "Proposal not found. It may already have been removed." }, { status: 404 });
    }

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: { sheetId: gid, dimension: "ROWS", startIndex: gridIndex, endIndex: gridIndex + 1 },
          },
        }],
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delete failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
