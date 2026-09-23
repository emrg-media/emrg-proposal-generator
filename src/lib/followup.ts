import "server-only";
import { and, eq, inArray, isNotNull, lte } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/db";
import { opportunities, users } from "@/db/schema";
import { logActivity } from "./activity";
import { OPEN_STAGES } from "./constants";
import { getSettings } from "./settings";

// The follow-up engine (brief §16): "NO PROPOSAL SHOULD QUIETLY DIE BECAUSE
// EVERYONE ASSUMED SOMEONE ELSE WAS FOLLOWING UP."
//
// This is the only part of the system that emails clients on its own, so it is
// deliberately cautious:
//
//  · OFF unless FOLLOWUPS_ENABLED=true. Sending on a client's behalf is opt-in.
//  · Never touches a paused, stopped or closed opportunity — the human takeover
//    in logActivity() sets `paused`, and that must always win.
//  · Claims the step BEFORE sending. If the process dies mid-run the client
//    gets one fewer email, never two; a duplicate chase is worse than a gap.
//  · previewFollowups() shows exactly what would go out, sending nothing.

export interface FollowupCandidate {
  id: string;
  code: string;
  company: string;
  contactName: string;
  email: string;
  eventName: string;
  eventDate: string;
  step: number;          // zero-based: 0 is the first chase
  dueAt: Date;
  ownerName: string;
  ownerId: string | null;
}

export interface FollowupResult {
  enabled: boolean;
  considered: number;
  sent: string[];
  skipped: Array<{ code: string; reason: string }>;
  failed: Array<{ code: string; error: string }>;
}

/** Everything currently due. Pure read — safe to call any time. */
export async function dueFollowups(now: Date = new Date()): Promise<FollowupCandidate[]> {
  const rows = await getDb()
    .select({ opp: opportunities, ownerName: users.name })
    .from(opportunities)
    .leftJoin(users, eq(users.id, opportunities.ownerId))
    .where(and(
      eq(opportunities.followupState, "active"),
      isNotNull(opportunities.followupDueAt),
      lte(opportunities.followupDueAt, now),
      // A proposal must actually have gone out — there is nothing to chase otherwise.
      isNotNull(opportunities.proposalSentAt),
      inArray(opportunities.stage, OPEN_STAGES),
    ))
    .orderBy(opportunities.followupDueAt);

  return rows.map(({ opp, ownerName }) => ({
    id: opp.id,
    code: opp.code,
    company: opp.company,
    contactName: [opp.firstName, opp.lastName].filter(Boolean).join(" "),
    email: opp.email,
    eventName: opp.eventName || opp.eventTypes.join(" / "),
    eventDate: opp.eventDate,
    step: opp.followupStep,
    dueAt: opp.followupDueAt!,
    ownerName: ownerName ?? "the EMRG team",
    ownerId: opp.ownerId,
  }));
}

// ── Message copy ─────────────────────────────────────────────────────────────

function firstName(full: string): string {
  const w = full.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "there";
  return /^(dr|mr|mrs|ms|miss|prof|rev)\.?$/i.test(w[0]) && w.length > 1 ? w[1] : w[0];
}

/** Escalates gently: a nudge, then a nudge with an offer, then a soft close. */
export function composeFollowup(c: FollowupCandidate): { subject: string; text: string } {
  const name = firstName(c.contactName);
  const event = c.eventName || "your event";
  const dated = c.eventDate ? `${event} on ${c.eventDate}` : event;

  const bodies = [
    [
      `Hi ${name},`, ``,
      `Just following up on the proposal we sent through for ${dated}.`, ``,
      `Any questions, or anything you'd like adjusted? Happy to jump on a quick call.`,
    ],
    [
      `Hi ${name},`, ``,
      `Checking back on ${dated}. I know these decisions take time.`, ``,
      `If it would help, I can put together a revised version with different options, or talk through the scope on a short call. Either is easy.`,
    ],
    [
      `Hi ${name},`, ``,
      `Last note from me on ${dated}. I don't want to keep filling your inbox.`, ``,
      `If the timing isn't right, no problem at all; just say the word and I'll close it off. And if you'd still like to move ahead, we're here.`,
    ],
  ];

  const body = bodies[Math.min(c.step, bodies.length - 1)];
  const text = [
    ...body, ``,
    `Best,`,
    c.ownerName,
    `EMRG Media | 212.254.3700`,
  ].join("\n");

  return { subject: `Following up on ${c.company || event}`, text };
}

// ── Preview ──────────────────────────────────────────────────────────────────

/** Exactly what would be sent, without sending. */
export async function previewFollowups(now: Date = new Date()) {
  const candidates = await dueFollowups(now);
  return candidates.map((c) => ({
    code: c.code,
    company: c.company,
    to: c.email,
    step: c.step + 1,
    dueAt: c.dueAt.toISOString(),
    blocked: !c.email.trim() ? "no email address on file" : null,
    ...composeFollowup(c),
  }));
}

// ── Send ─────────────────────────────────────────────────────────────────────

export async function runFollowups(now: Date = new Date()): Promise<FollowupResult> {
  const result: FollowupResult = {
    enabled: process.env.FOLLOWUPS_ENABLED === "true",
    considered: 0, sent: [], skipped: [], failed: [],
  };

  const candidates = await dueFollowups(now);
  result.considered = candidates.length;
  if (!result.enabled) {
    result.skipped = candidates.map((c) => ({ code: c.code, reason: "FOLLOWUPS_ENABLED is not true" }));
    return result;
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    result.skipped = candidates.map((c) => ({ code: c.code, reason: "SMTP is not configured" }));
    return result;
  }

  const { followupCadenceDays } = await getSettings();
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: parseInt(SMTP_PORT || "587"),
    secure: parseInt(SMTP_PORT || "587") === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const db = getDb();

  for (const c of candidates) {
    if (!c.email.trim()) {
      result.skipped.push({ code: c.code, reason: "no email address on file" });
      continue;
    }

    const nextStep = c.step + 1;
    const moreToGo = nextStep < followupCadenceDays.length;
    const nextDue = moreToGo
      ? new Date(now.getTime() + (followupCadenceDays[nextStep] - followupCadenceDays[c.step]) * 86_400_000)
      : null;

    // Claim first. The WHERE clause pins the due date we read, so a second run
    // racing this one updates nothing and cannot send the same chase twice.
    const claimed = await db.update(opportunities).set({
      followupStep: nextStep,
      followupDueAt: nextDue,
      followupState: moreToGo ? "active" : "stopped",
    }).where(and(
      eq(opportunities.id, c.id),
      eq(opportunities.followupState, "active"),
      eq(opportunities.followupDueAt, c.dueAt),
    )).returning({ id: opportunities.id });

    if (claimed.length === 0) {
      result.skipped.push({ code: c.code, reason: "already handled by another run" });
      continue;
    }

    const { subject, text } = composeFollowup(c);
    try {
      await transporter.sendMail({
        from: SMTP_FROM || SMTP_USER,
        to: c.email,
        bcc: process.env.SMTP_BCC || "events@emrgmedia.com",
        subject,
        text,
      });

      await logActivity({
        opportunityId: c.id,
        type: "followup_sent",
        actorId: null,
        body: `Follow-up ${nextStep} sent to ${c.email}`,
        meta: { step: nextStep, subject, auto: true },
        occurredAt: now,
      });
      result.sent.push(c.code);
    } catch (err) {
      // The step is already claimed, so this will not silently retry. Put it on
      // the timeline instead, where a human will see it.
      const message = err instanceof Error ? err.message : "send failed";
      result.failed.push({ code: c.code, error: message });
      await logActivity({
        opportunityId: c.id,
        type: "note",
        actorId: null,
        body: `Automated follow-up ${nextStep} could not be sent: ${message}`,
        meta: { step: nextStep, error: message, auto: true },
        occurredAt: now,
      }).catch(() => {});
    }
  }

  return result;
}

/** Arm the sequence when a proposal goes out. Exported for reuse and testing. */
export function firstDueDate(cadenceDays: number[], from: Date = new Date()): Date {
  return new Date(from.getTime() + (cadenceDays[0] ?? 1) * 86_400_000);
}

