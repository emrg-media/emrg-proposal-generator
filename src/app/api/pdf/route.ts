import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { buildProposalDocument } from "@/lib/ProposalPDF";

export async function POST(req: NextRequest) {
  const data = await req.json();

  const logoPath = join(process.cwd(), "public", "emrg-logo.png");
  const logoBase64 = readFileSync(logoPath).toString("base64");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(buildProposalDocument({ ...data, logoBase64 }) as any);

  const clientName = (data.client_name || "proposal").replace(/[^a-z0-9]/gi, "-").toLowerCase();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${clientName}-proposal.pdf"`,
    },
  });
}
