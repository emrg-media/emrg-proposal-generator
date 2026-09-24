import { NextRequest, NextResponse } from "next/server";
import { verifyWebhook } from "@/lib/svix";
import { toInboundEmail, type ResendReceivedEvent } from "@/lib/resendInbound";
import { processInboundEmail } from "@/lib/emailIntake";

// Where forwarded mail lands.
//
// A Gmail filter on info@ forwards to a Resend receiving address, Resend calls
// this, and the message becomes an opportunity. That path needs no Workspace
// admin approval, which is why it exists alongside the eventual Gmail API one.
//
// This is a public URL that writes to the database, so it is strict:
//   · the raw body is verified against the signature before anything is parsed;
//   · a replayed request is refused by the timestamp window;
//   · mail that fails SPF or DMARC is dropped, not filed;
//   · a 200 is returned for anything we deliberately ignore, so the sender does
//     not retry a message we have already decided about.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;

  if (!secret || !apiKey) {
    // Fail closed. An unconfigured endpoint must never accept anything.
    return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
  }

  // The signature covers the exact bytes sent, so the body is read as text and
  // only parsed once it has been proven authentic.
  const raw = await req.text();

  const verified = verifyWebhook(raw, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  }, secret);

  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 401 });
  }

  let event: ResendReceivedEvent;
  try {
    event = JSON.parse(raw) as ResendReceivedEvent;
  } catch {
    return NextResponse.json({ error: "Body was not JSON." }, { status: 400 });
  }

  // Resend sends every subscribed event here; only inbound mail is ours.
  if (event.type !== "email.received") {
    return NextResponse.json({ ignored: event.type });
  }

  try {
    const converted = await toInboundEmail(event, apiKey);
    if ("rejected" in converted) {
      return NextResponse.json({ action: "ignored", reason: converted.rejected });
    }

    const result = await processInboundEmail(converted.mail);
    return NextResponse.json(result);
  } catch (err) {
    // A real failure gets a 500 so Resend retries; anything we chose to skip
    // has already returned 200 above.
    const message = err instanceof Error ? err.message : "Inbound processing failed";
    console.error("Resend inbound failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
