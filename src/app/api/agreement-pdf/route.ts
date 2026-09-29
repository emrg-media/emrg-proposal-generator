import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import { AgreementPDF, type AgreementData } from "@/lib/AgreementPDF";
import { getSessionUser } from "@/lib/auth";

// The Event Planning Agreement. Separate from the proposal because Erica sends
// it alongside the scope sometimes and on its own other times, depending on
// whether the client wants to approve the scope first.

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const data = (await req.json()) as AgreementData;

  const logoPath = join(process.cwd(), "public", "emrg-logo.png");
  const logoBase64 = readFileSync(logoPath).toString("base64");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = createElement(AgreementPDF, { data: { ...data, logoBase64 } }) as any;
  const buffer = await renderToBuffer(doc);

  const name = (data.client_name || "agreement").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}-event-planning-agreement.pdf"`,
    },
  });
}
