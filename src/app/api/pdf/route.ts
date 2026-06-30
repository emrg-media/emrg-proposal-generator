import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { readFileSync } from "fs";
import { join } from "path";
import { ProposalPDF } from "@/lib/ProposalPDF";

export async function POST(req: NextRequest) {
  const data = await req.json();

  const logoPath = join(process.cwd(), "public", "emrg-logo.png");
  const logoBase64 = readFileSync(logoPath).toString("base64");

  const buffer = await renderToBuffer(
    createElement(ProposalPDF, { data: { ...data, logoBase64 } })
  );

  const clientName = (data.client_name || "proposal").replace(/[^a-z0-9]/gi, "-").toLowerCase();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${clientName}-proposal.pdf"`,
    },
  });
}
