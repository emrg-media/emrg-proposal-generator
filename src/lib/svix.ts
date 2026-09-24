import { createHmac, timingSafeEqual } from "node:crypto";

// Webhook signature verification, in the scheme Resend uses (Svix).
//
// Written out rather than pulled from a library because it is short, it is the
// only thing standing between a public URL and our database, and it is worth
// being able to read and test every line of it.
//
// The signature covers `${id}.${timestamp}.${rawBody}`, so the body must be the
// exact bytes received. Parsing the JSON first and re-serialising it changes
// the string and every signature fails.

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

/** Replay window. Svix's own default, and long enough for a slow retry. */
const TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhook(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  now: Date = new Date(),
): VerifyResult {
  if (!secret) return { ok: false, reason: "No signing secret configured" };
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "Missing signature headers" };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "Bad timestamp" };

  // Reject anything too old to be a live delivery, and anything from the
  // future, which would let a captured request be replayed indefinitely.
  const drift = Math.abs(Math.floor(now.getTime() / 1000) - sent);
  if (drift > TOLERANCE_SECONDS) return { ok: false, reason: "Timestamp outside tolerance" };

  // Secrets are handed out as whsec_<base64>; the raw key is the decoded part.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  // The header may carry several space-separated versioned signatures during a
  // secret rotation. Any valid v1 entry is enough.
  const offered = signature.split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice(3));

  if (offered.length === 0) return { ok: false, reason: "No v1 signature offered" };

  const expectedBuf = Buffer.from(expected);
  const matched = offered.some((candidate) => {
    const candidateBuf = Buffer.from(candidate);
    // timingSafeEqual throws on a length mismatch, which is itself a mismatch.
    if (candidateBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(candidateBuf, expectedBuf);
  });

  return matched ? { ok: true } : { ok: false, reason: "Signature does not match" };
}

/** Build a signature the way the sender would. Used by the tests. */
export function signWebhook(rawBody: string, id: string, timestamp: string, secret: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return `v1,${sig}`;
}
