import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { buildInvoiceDocument } from "@/lib/InvoicePDF";
import type { InvoiceData } from "@/lib/invoice";

export async function POST(req: NextRequest) {
  const data = (await req.json()) as InvoiceData;

  const logoPath = join(process.cwd(), "public", "emrg-logo.png");
  const logoBase64 = readFileSync(logoPath).toString("base64");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(buildInvoiceDocument(data, logoBase64) as any);

  const name = (data.invoiceNumber || data.company || "invoice").replace(/[^a-z0-9]/gi, "-").toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
    },
  });
}
