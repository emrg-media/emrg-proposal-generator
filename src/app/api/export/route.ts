import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { buildExport } from "@/lib/opportunityExport";
import { toCsv, csvFilename } from "@/lib/csv";

// Full database export. Opens straight into Excel, Numbers or Sheets.

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { headers, rows } = await buildExport();
  const csv = toCsv(headers, rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename("emrg-opportunities")}"`,
      "Cache-Control": "no-store",
    },
  });
}
