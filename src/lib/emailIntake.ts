import "server-only";
import { and, desc, inArray, sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { getDb } from "@/db";
import { opportunities, opportunityCollaborators, type User } from "@/db/schema";
import { logActivity } from "./activity";
import { OPEN_STAGES, EVENT_TYPES, LEAD_SOURCES } from "./constants";
import { newOpportunityCode } from "./opportunities";
import { decideOwner } from "./routingService";
import { checkCompleteness } from "./completeness";
import { computeFee, toCents, budgetText, parseMoneyToCents } from "./fee";
import {
  parseAddress, splitName, cleanBody, isAutomated, normalizeSubject, findForwardedSender,
} from "./emailParse";

// Inbound email becomes an opportunity.
//
// Everything here is independent of WHERE the mail came from, so connecting
// Gmail later is a matter of calling processInboundEmail() with each new
// message rather than building this again. A forwarded message or a pasted one
// exercises exactly the same path today.

export interface InboundEmail {
  fromEmail: string;
  fromName?: string;
  to?: string;
  subject: string;
  body: string;
  receivedAt?: Date;
  messageId?: string;
  headers?: Record<string, string>;
}

export type IntakeResult =
  | { action: "created"; opportunityId: string; code: string; ownerId: string | null;
      routingReason: string; missing: string[] }
  | { action: "reply_logged"; opportunityId: string; code: string }
  | { action: "ignored"; reason: string };

const client = new Anthropic();

interface Extracted {
  is_event_enquiry?: boolean;
  confidence?: string;
  company?: string; first_name?: string; last_name?: string; title?: string;
  email?: string; cell_phone?: string; website?: string;
  lead_source?: string; event_name?: string; event_types?: string[];
  event_date?: string; guest_count?: string; venue?: string;
  budget_low?: string; budget_high?: string; service_fee?: string;
  requested_services?: string[]; notes?: string;
}

const SYSTEM = `You read inbound email sent to an event production company and decide whether it is a new event enquiry, then pull out whatever event detail is present.
Today is ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}. Resolve relative dates against it and never return a date in the past.
Return ONLY valid JSON. Use "" for absent strings and [] for absent arrays. Never invent anything, and never guess an email address.

{
  "is_event_enquiry": boolean — true only if the sender is asking about running an event or continuing a conversation about one. False for newsletters, invoices, job applications, supplier pitches, internal chatter and anything unrelated. When in doubt, false.,
  "confidence": "high | medium | low, reflecting how much usable event detail is actually present",
  "company": "", "first_name": "", "last_name": "", "title": "", "email": "", "cell_phone": "", "website": "",
  "lead_source": "one of: ${LEAD_SOURCES.join(", ")}, or empty",
  "event_name": "a short natural name, e.g. 'Google Holiday Party'",
  "event_types": ["copied EXACTLY from: ${EVENT_TYPES.filter((t) => t !== "Other").join(", ")}, or a Title Case label when nothing fits"],
  "event_date": "", "guest_count": "digits only, e.g. 250 or 100-150", "venue": "",
  "budget_low": "", "budget_high": "",
  "service_fee": "exactly as stated, a dollar amount or a percentage. Never convert one into the other.",
  "requested_services": [], "notes": "anything else worth keeping, a few sentences at most"
}`;

async function extract(subject: string, body: string): Promise<Extracted> {
  const message = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    messages: [{ role: "user", content: `Subject: ${subject}\n\n${body.slice(0, 40_000)}` }],
  });
  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : text) as Extracted;
}

/** An open opportunity already belonging to this sender, if there is one. */
async function findOpenThread(email: string) {
  if (!email) return null;
  const [row] = await getDb()
    .select({ id: opportunities.id, code: opportunities.code })
    .from(opportunities)
    .where(and(
      sql`lower(${opportunities.email}) = ${email.toLowerCase()}`,
      inArray(opportunities.stage, OPEN_STAGES),
    ))
    .orderBy(desc(opportunities.lastActivityAt))
    .limit(1);
  return row ?? null;
}

export async function processInboundEmail(mail: InboundEmail): Promise<IntakeResult> {
  // Work out who really sent it. A forwarded enquiry carries the client's
  // address inside the body; without this the colleague who forwarded it would
  // be recorded as the lead.
  const envelope = parseAddress(
    mail.fromName ? `${mail.fromName} <${mail.fromEmail}>` : mail.fromEmail,
  );
  const body = cleanBody(mail.body);
  const forwarded = findForwardedSender(mail.body);
  const sender = forwarded ?? envelope;

  if (!sender.email) return { action: "ignored", reason: "No sender address" };

  if (isAutomated({
    fromEmail: envelope.email, subject: mail.subject, body: mail.body, headers: mail.headers,
  })) {
    return { action: "ignored", reason: "Automated message, not a person" };
  }

  // Never create a second record for someone already being worked. Logging it
  // as an inbound message is what pauses follow-ups and puts the deal into
  // "client waiting on us".
  const existing = await findOpenThread(sender.email);
  if (existing) {
    await logActivity({
      opportunityId: existing.id,
      type: "email_in",
      actorId: null,
      body: normalizeSubject(mail.subject) || "Client replied by email",
      meta: { via: "email-intake", messageId: mail.messageId, from: sender.email },
      occurredAt: mail.receivedAt ?? new Date(),
    });
    return { action: "reply_logged", opportunityId: existing.id, code: existing.code };
  }

  const data = await extract(mail.subject, body);
  if (data.is_event_enquiry === false) {
    return { action: "ignored", reason: "Not an event enquiry" };
  }

  const nameFromMail = splitName(sender.name);
  const firstName = data.first_name || nameFromMail.firstName;
  const lastName = data.last_name || nameFromMail.lastName;
  const eventTypes = data.event_types?.filter(Boolean) ?? [];

  const feeRaw = data.service_fee ?? "";
  const budgetLowCents = parseMoneyToCents(data.budget_low ?? "");
  const budgetHighCents = parseMoneyToCents(data.budget_high ?? "");
  const resolved = computeFee(feeRaw, budgetText(budgetLowCents, budgetHighCents));

  // No human is involved, so routing decides ownership on its own. This is the
  // case the routing rules exist for.
  const routed = await decideOwner({
    company: data.company ?? "",
    // The envelope address is authoritative; a body-mentioned address is not.
    email: sender.email,
    eventTypes,
    leadSource: data.lead_source || "Inbound Email",
    valueCents: toCents(resolved.value),
  }, null);

  // The clock starts when the mail arrived, not when the system got round to
  // it, or every lead would appear to have been answered instantly.
  const leadReceivedAt = mail.receivedAt ?? new Date();

  const db = getDb();
  const created = await db.transaction(async (tx) => {
    const [opp] = await tx.insert(opportunities).values({
      code: newOpportunityCode(),
      company: data.company ?? "",
      firstName, lastName,
      title: data.title ?? "",
      email: sender.email,
      cellPhone: data.cell_phone ?? "",
      website: data.website ?? "",
      leadSource: data.lead_source || "Inbound Email",
      leadReceivedAt,
      rawIntake: {
        via: "email",
        subject: mail.subject,
        from: sender.email,
        forwarded: !!forwarded,
        messageId: mail.messageId,
        confidence: data.confidence ?? "",
        body: mail.body.slice(0, 20_000),
      },
      eventName: data.event_name ?? "",
      eventTypes,
      eventDate: data.event_date ?? "",
      guestCount: data.guest_count ?? "",
      venue: data.venue ?? "",
      requestedServices: data.requested_services?.filter(Boolean) ?? [],
      notes: data.notes ?? "",
      feeRaw,
      budgetLowCents, budgetHighCents,
      proposalValueCents: toCents(resolved.value),
      valueEstimated: resolved.estimated,
      ownerId: routed.userId,
      stage: "new_lead",
      lastActivityAt: leadReceivedAt,
    }).returning();

    if (routed.collaboratorIds.length > 0) {
      await tx.insert(opportunityCollaborators).values(
        [...new Set(routed.collaboratorIds)].map((userId) => ({ opportunityId: opp.id, userId })),
      ).onConflictDoNothing();
    }

    await logActivity({
      opportunityId: opp.id, type: "lead_received", actorId: null,
      body: `Lead received by email: ${normalizeSubject(mail.subject) || "(no subject)"}`,
      meta: { via: "email", from: sender.email, messageId: mail.messageId },
      occurredAt: leadReceivedAt,
    }, tx);

    if (routed.userId) {
      await logActivity({
        opportunityId: opp.id, type: "owner_change", actorId: null,
        body: `Assigned automatically. ${routed.reason}`,
        meta: { routed: true, reason: routed.reason },
        occurredAt: leadReceivedAt,
      }, tx);
    }

    return opp;
  });

  const completeness = checkCompleteness(created);
  return {
    action: "created",
    opportunityId: created.id,
    code: created.code,
    ownerId: routed.userId,
    routingReason: routed.reason,
    missing: [...completeness.blocking, ...completeness.important].map((m) => m.label),
  };
}

/** Used by the paste path, where a signed-in person is watching. */
export async function processPastedEmail(raw: string, actor: User): Promise<IntakeResult> {
  const parsed = parseRawEmail(raw);
  const result = await processInboundEmail(parsed);
  if (result.action === "created") {
    await logActivity({
      opportunityId: result.opportunityId, type: "note", actorId: actor.id,
      body: `Email pasted in by ${actor.name}`,
      meta: { via: "paste" },
    });
  }
  return result;
}

/** Pull From/Subject/Date headers out of a pasted message, then the body. */
export function parseRawEmail(raw: string): InboundEmail {
  const text = (raw ?? "").replace(/\r\n/g, "\n");
  const header = (name: string) =>
    text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "im"))?.[1]?.trim() ?? "";

  const from = header("From");
  const { email, name } = parseAddress(from);
  const dateRaw = header("Date") || header("Sent");
  const parsedDate = dateRaw ? new Date(dateRaw) : null;

  // Everything after the last recognised header line is the message itself.
  const lastHeader = [...text.matchAll(/^\s*(from|to|cc|subject|date|sent|reply-to):\s*.+$/gim)].pop();
  const bodyStart = lastHeader ? (lastHeader.index ?? 0) + lastHeader[0].length : 0;

  return {
    fromEmail: email,
    fromName: name,
    to: header("To"),
    subject: header("Subject"),
    body: text.slice(bodyStart).trim() || text.trim(),
    receivedAt: parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : undefined,
  };
}
