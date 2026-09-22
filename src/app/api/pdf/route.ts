import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { readFileSync } from "fs";
import { join } from "path";
import { buildProposalDocument } from "@/lib/ProposalPDF";
import { getSessionUser } from "@/lib/auth";
import { recordGenerated } from "@/lib/recordProposal";

// Renders the proposal PDF (unchanged) and records the version against the
// opportunity, so nothing that gets generated is ever lost.

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const data = await req.json();

  // Await rather than fire-and-forget: Vercel freezes the function once the
  // response is returned, which would kill an un-awaited write.
  await recordGenerated(data, user);

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
