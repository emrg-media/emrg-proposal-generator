import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { buildInvoiceDocument } from "@/lib/InvoicePDF";
import type { InvoiceData } from "@/lib/invoice";
import { getSessionUser } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // proxy.ts only checks that the cookie is signed; it deliberately does not
  // re-read the user row. Without this, a deactivated employee's cookie keeps
  // rendering invoices for the rest of its two-week life, while every other
  // route correctly refuses them.
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

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
