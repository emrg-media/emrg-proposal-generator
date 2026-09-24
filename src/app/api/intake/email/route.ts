import { NextRequest, NextResponse } from "next/server";
import { processInboundEmail } from "@/lib/emailIntake";
import { getSessionUser } from "@/lib/auth";

// Where inbound mail arrives. Deliberately source-agnostic: a Gmail watcher, a
// forwarding service or a test payload all post the same shape, so connecting
// Gmail later is configuration rather than another feature.
//
// Authenticated by INTAKE_SECRET because the caller is a machine, not a signed
// in person. A signed-in session is also accepted so the team can use the paste
// path in the app. Fails closed when the secret is unset.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fromTrustedSource(req: NextRequest): boolean {
  const secret = process.env.INTAKE_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user && !fromTrustedSource(req)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const mail = payload as Record<string, unknown>;
  const fromEmail = typeof mail.fromEmail === "string" ? mail.fromEmail
    : typeof mail.from === "string" ? mail.from : "";
  const body = typeof mail.body === "string" ? mail.body
    : typeof mail.text === "string" ? mail.text : "";

  if (!fromEmail || !body.trim()) {
    return NextResponse.json({ error: "fromEmail and body are required." }, { status: 400 });
  }

  const receivedRaw = mail.receivedAt ?? mail.date;
  const receivedAt = typeof receivedRaw === "string" ? new Date(receivedRaw) : undefined;

  try {
    const result = await processInboundEmail({
      fromEmail,
      fromName: typeof mail.fromName === "string" ? mail.fromName : undefined,
      to: typeof mail.to === "string" ? mail.to : undefined,
      subject: typeof mail.subject === "string" ? mail.subject : "",
      body,
      receivedAt: receivedAt && !isNaN(receivedAt.getTime()) ? receivedAt : undefined,
      messageId: typeof mail.messageId === "string" ? mail.messageId : undefined,
      headers: (mail.headers && typeof mail.headers === "object")
        ? (mail.headers as Record<string, string>) : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Intake failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
