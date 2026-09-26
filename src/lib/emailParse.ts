// Turning a raw email into something worth extracting from.
//
// Pure, because this is where inbound mail actually goes wrong: quoted reply
// chains, signatures, auto-responders and display names in half a dozen
// formats. Feeding all of that to the extractor produces confident nonsense,
// so it is cleaned first and the cleaning is tested on its own.

export interface ParsedAddress {
  email: string;
  name: string;
}

/** Handles "Jane Doe <jane@x.com>", "jane@x.com", and quoted display names. */
export function parseAddress(raw: string): ParsedAddress {
  const s = (raw ?? "").trim();
  if (!s) return { email: "", name: "" };

  const angled = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, "").trim();
    return { email: angled[2].trim().toLowerCase(), name };
  }
  return { email: s.toLowerCase(), name: "" };
}

/** "Jane Doe" -> first/last. Handles "Doe, Jane" and a bare single name. */
export function splitName(full: string): { firstName: string; lastName: string } {
  const s = (full ?? "").trim();
  if (!s) return { firstName: "", lastName: "" };

  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    if (last && first) return { firstName: first, lastName: last };
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

// Lines that begin a quoted reply chain. Everything from here down is history.
const QUOTE_MARKERS = [
  /^\s*On .+ wrote:\s*$/i,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^\s*_{5,}\s*$/,
  /^\s*From:\s.+$/i,
  /^\s*Sent from my \w+/i,
];

// Where a signature starts. Kept conservative: cutting real content is worse
// than leaving a signature in, because the extractor copes with noise.
const SIGNATURE_MARKERS = [
  /^\s*--\s*$/,
  /^\s*(best|kind)\s+regards[,.]?\s*$/i,
  /^\s*(thanks|thank you|cheers|best|regards|sincerely)[,.]?\s*$/i,
];

/**
 * The part of the email the sender actually wrote now.
 *
 * Quoted history is always removed: extracting from an old thread produces
 * details that belong to a different conversation. A signature is KEPT by
 * default, because it usually carries the company name and job title, which
 * are exactly what we are trying to learn and are otherwise nowhere in the
 * message. Pass stripSignature when the trailing block is genuinely noise.
 */
export function cleanBody(raw: string, opts: { stripSignature?: boolean } = {}): string {
  const lines = (raw ?? "").replace(/\r\n/g, "\n").split("\n");

  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (QUOTE_MARKERS.some((re) => re.test(lines[i]))) { end = i; break; }
    // A run of quoted lines also ends the fresh content.
    if (/^\s*>/.test(lines[i])) { end = i; break; }
  }

  let body = lines.slice(0, end);

  if (opts.stripSignature) {
    // Only from the back half, so an email opening with "Thanks," is not
    // reduced to nothing.
    for (let i = Math.floor(body.length / 2); i < body.length; i++) {
      if (SIGNATURE_MARKERS.some((re) => re.test(body[i]))) { body = body.slice(0, i); break; }
    }
  }

  return body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Mail that must never create a lead or count as a client reply: bounces,
 * holiday responders, calendar traffic and bulk sends.
 */
export function isAutomated(headersAndBody: {
  fromEmail: string; subject: string; body: string; headers?: Record<string, string>;
}): boolean {
  const { fromEmail, subject, body, headers = {} } = headersAndBody;
  const lower = (s: string) => (s ?? "").toLowerCase();

  const h = Object.fromEntries(Object.entries(headers).map(([k, v]) => [lower(k), lower(v)]));
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] || h["x-autorespond"] || h["list-unsubscribe"]) return true;
  if (h["precedence"] && ["bulk", "junk", "auto_reply"].includes(h["precedence"])) return true;

  const from = lower(fromEmail);
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce)/.test(from.split("@")[0] ?? "")) {
    return true;
  }

  const subj = lower(subject);
  if (/^(out of office|automatic reply|auto:|undeliverable|delivery status|read:)/.test(subj.trim())) {
    return true;
  }
  if (/\b(unsubscribe|view this email in your browser)\b/.test(lower(body))) return true;

  return false;
}

/** Strip "Re:", "Fwd:" and friends so a subject can be compared or reused. */
export function normalizeSubject(subject: string): string {
  return (subject ?? "").replace(/^(\s*(re|fwd|fw|aw|tr)\s*:\s*)+/i, "").trim();
}

/**
 * A forwarded message carries the original sender inside the body. Without
 * this, every forwarded enquiry would be attributed to the colleague who
 * forwarded it rather than the client.
 */
export function findForwardedSender(body: string): ParsedAddress | null {
  const text = (body ?? "").replace(/\r\n/g, "\n");
  const marker = text.match(/-{2,}\s*Forwarded message\s*-{2,}|^\s*Begin forwarded message:/im);
  if (!marker || marker.index === undefined) return null;

  // Search only AFTER the marker. Taking the first "From:" anywhere in the
  // body let a line above the marker decide who the lead was, which is
  // attacker-controlled: anyone can email the address that gets forwarded.
  const after = text.slice(marker.index + marker[0].length);
  const from = after.match(/^\s*From:\s*(.+)$/im);
  if (!from) return null;

  const parsed = parseAddress(from[1]);
  // Require something that is actually an address. "From: Accounts Payable"
  // otherwise yields the truthy string "accounts payable", which then REPLACES
  // a perfectly good envelope address with garbage.
  return isEmailAddress(parsed.email) ? parsed : null;
}

/** Deliberately conservative: this decides who a lead is attributed to. */
export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}
