import "server-only";
import type { InboundEmail } from "./emailIntake";

// Adapter between Resend's receiving webhook and our own intake shape.
//
// Two things about Resend's design drive this file:
//
//  1. The webhook carries metadata ONLY, not the message. The body, headers and
//     attachments have to be fetched afterwards, which keeps large attachments
//     out of a serverless request body.
//  2. The fetch also returns SPF, DKIM and DMARC results computed by the
//     receiving server rather than read from the message, so a sender cannot
//     forge them. That is worth acting on: inbound mail is the one untrusted
//     input in this system.

export interface ResendReceivedEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    message_id?: string;
    from?: string;
    to?: string[];
    subject?: string;
    created_at?: string;
    received_for?: string[];
  };
}

interface ReceivedEmailBody {
  text?: string;
  html?: string;
  headers?: Record<string, string> | Array<{ name: string; value: string }>;
  received_for?: string[];
  authentication?: {
    spf?: string;
    dkim?: string;
    dmarc?: string;
  } | null;
}

const API = "https://api.resend.com";

/** Headers come back as either a map or a list depending on the message. */
function normalizeHeaders(
  raw: ReceivedEmailBody["headers"],
): Record<string, string> {
  if (!raw) return {};
  if (Array.isArray(raw)) {
    return Object.fromEntries(raw.map((h) => [h.name, h.value]));
  }
  return raw;
}

/**
 * Mail that failed its sender checks.
 *
 * A hard SPF or DMARC failure means the message is not from who it claims to
 * be. Creating an opportunity from it, or worse matching it onto an existing
 * client's record as a reply, is how a spoofed message gets into the pipeline.
 * Anything inconclusive is let through, since strict rejection would drop real
 * enquiries from badly configured senders.
 */
export function failsSenderChecks(auth: ReceivedEmailBody["authentication"]): string | null {
  if (!auth) return null;
  if (auth.spf === "fail") return "SPF check failed";
  if (auth.dmarc === "fail") return "DMARC check failed";
  return null;
}

export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
): Promise<ReceivedEmailBody> {
  const res = await fetch(`${API}/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Could not fetch the received email (${res.status})`);
  }
  return (await res.json()) as ReceivedEmailBody;
}

/**
 * Turn a verified webhook event into the shape the intake pipeline takes,
 * fetching the body that the webhook deliberately leaves out.
 */
export async function toInboundEmail(
  event: ResendReceivedEvent,
  apiKey: string,
): Promise<{ mail: InboundEmail } | { rejected: string }> {
  const data = event.data ?? {};
  if (!data.email_id) return { rejected: "Event carried no email id" };

  const body = await fetchReceivedEmail(data.email_id, apiKey);

  const spoofed = failsSenderChecks(body.authentication);
  if (spoofed) return { rejected: spoofed };

  const headers = normalizeHeaders(body.headers);

  // On a received event `from` is the bare address; the display name survives
  // in the original From header, which arrives with the body.
  const fromHeader = headers["From"] ?? headers["from"] ?? "";
  const displayName = fromHeader.match(/^\s*(.*?)\s*</)?.[1]?.replace(/^["']|["']$/g, "") ?? "";

  const received = data.created_at ?? event.created_at;
  const receivedAt = received ? new Date(received) : undefined;

  return {
    mail: {
      fromEmail: data.from ?? "",
      fromName: displayName || undefined,
      // Which of EMRG's addresses this actually arrived for. With a Gmail
      // forwarding rule the envelope recipient is our Resend address, so this
      // is the only record of whether it came in on info@ or a planner's inbox.
      to: (data.received_for ?? body.received_for ?? data.to ?? [])[0],
      subject: data.subject ?? "",
      body: body.text?.trim() || stripHtml(body.html ?? ""),
      receivedAt: receivedAt && !isNaN(receivedAt.getTime()) ? receivedAt : undefined,
      messageId: data.message_id ?? data.email_id,
      headers,
    },
  };
}

/** Crude but adequate: only ever used when a message has no plain text part. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
