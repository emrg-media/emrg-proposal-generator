import { NextResponse } from "next/server";
import { google } from "googleapis";

// Returns all tracker rows for the dashboard. Reads the same sheet the logger writes.

export const dynamic = "force-dynamic";

export async function GET() {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) {
    return NextResponse.json({ error: "Tracker is not configured." }, { status: 500 });
  }

  try {
    const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Proposals!A2:Q",
    });

    const proposals = (res.data.values ?? [])
      .filter((r) => r[0])
      .map((r) => ({
        id: r[0] ?? "",
        proposalDate: r[1] ?? "",
        preparedBy: r[2] ?? "",
        client: r[3] ?? "",
        company: r[4] ?? "",
        email: r[5] ?? "",
        event: r[6] ?? "",
        eventDates: r[7] ?? "",
        guests: r[8] ?? "",
        venue: r[9] ?? "",
        budget: r[10] ?? "",
        fee: r[11] ?? "",
        status: r[12] ?? "Generated",
        sentAt: r[13] ?? "",
        followUp: r[14] ?? "",
        notes: r[15] ?? "",
        sort: r[16] ?? "",
      }));

    return NextResponse.json({ proposals });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read tracker";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
