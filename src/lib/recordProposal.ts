import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { opportunities, proposals, type User } from "@/db/schema";
import { logActivity } from "./activity";
import { computeFee, toCents, budgetText, parseMoneyToCents } from "./fee";
import { newOpportunityCode } from "./opportunities";
import { OPEN_STAGES } from "./constants";

// Writing a proposal into the permanent record (brief §6). Every generated
// version is kept forever, whatever becomes of the deal, and the snapshot is
// the exact payload the PDF was rendered from — so any past proposal can be
// reproduced byte-for-byte later.

export interface ProposalPayload {
  /** Absent when the planner started from the generator rather than a record. */
  opportunity_id?: string;
  /** When the enquiry actually arrived, so speed-to-lead stays honest. */
  enquiry_received_at?: string;
  lead_source?: string;
  client_name?: string;
  signer_name?: string;
  signer_title?: string;
  client_email?: string;
  venue?: string;
  prepared_by?: string;
  budget_low?: string;
  budget_high?: string;
  service_fee?: string;
  events?: Array<{ date?: string; eventTypes?: string[]; guestCount?: string }>;
  selectedServices?: string[];
  subject?: string;
  body?: string;
}

/**
 * The proposal generator is the team's real front door: a client calls, a
 * planner fills the form, the proposal goes out. That IS the lead entering the
 * funnel, so generating a proposal must not require someone to have created a
 * record first — this finds the matching opportunity or opens one.
 *
 * Matching is by contact email against a still-open opportunity, so a second
 * or third version lands on the same deal instead of forking a duplicate.
 * Without an email there is nothing safe to match on, so a new record is made.
 */
export async function findOrCreateOpportunity(
  payload: ProposalPayload, actor: User,
): Promise<string> {
  const db = getDb();
  const email = (payload.client_email ?? "").trim().toLowerCase();

  if (email) {
    const [existing] = await db.select({ id: opportunities.id })
      .from(opportunities)
      .where(and(
        sql`lower(${opportunities.email}) = ${email}`,
        inArray(opportunities.stage, OPEN_STAGES),
      ))
      .orderBy(desc(opportunities.lastActivityAt))
      .limit(1);
    if (existing) return existing.id;
  }

  const nameParts = (payload.signer_name ?? "").trim().split(/\s+/).filter(Boolean);
  const eventTypes = [...new Set((payload.events ?? []).flatMap((e) => e.eventTypes ?? []))];
  const firstEvent = payload.events?.[0];

  // A phone enquiry answered on Tuesday and quoted on Wednesday must not look
  // like a one-second response, so the planner can say when it actually came in.
  const enquiredAt = payload.enquiry_received_at
    ? new Date(payload.enquiry_received_at)
    : new Date();
  const leadReceivedAt = isNaN(enquiredAt.getTime()) ? new Date() : enquiredAt;

  const feeRaw = payload.service_fee ?? "";
  const budgetLowCents = parseMoneyToCents(payload.budget_low ?? "");
  const budgetHighCents = parseMoneyToCents(payload.budget_high ?? "");
  const resolved = computeFee(feeRaw, budgetText(budgetLowCents, budgetHighCents));

  return db.transaction(async (tx) => {
    const [opp] = await tx.insert(opportunities).values({
      code: newOpportunityCode(),
      company: payload.client_name ?? "",
      firstName: nameParts[0] ?? "",
      lastName: nameParts.slice(1).join(" "),
      title: payload.signer_title ?? "",
      email: payload.client_email ?? "",
      leadSource: payload.lead_source || "Proposal Generator",
      leadReceivedAt,
      rawIntake: { via: "proposal-generator" },
      eventName: [payload.client_name, eventTypes[0]].filter(Boolean).join(" "),
      eventTypes,
      eventDate: firstEvent?.date ?? "",
      guestCount: firstEvent?.guestCount ?? "",
      venue: payload.venue ?? "",
      requestedServices: payload.selectedServices ?? [],
      feeRaw,
      budgetLowCents, budgetHighCents,
      proposalValueCents: toCents(resolved.value),
      valueEstimated: resolved.estimated,
      ownerId: actor.id,
      createdById: actor.id,
      lastTouchedById: actor.id,
      stage: "proposal_needed",
      lastActivityAt: leadReceivedAt,
    }).returning();

    await logActivity({
      opportunityId: opp.id,
      type: "lead_received",
      actorId: null,
      body: payload.lead_source
        ? `Lead received via ${payload.lead_source}`
        : "Lead received, entered through the proposal generator",
      meta: { via: "proposal-generator", enteredBy: actor.name },
      occurredAt: leadReceivedAt,
    }, tx);

    return opp.id;
  });
}

/** Record a generated version. Returns the version and the opportunity it belongs to. */
export async function recordGenerated(
  payload: ProposalPayload, actor: User,
): Promise<{ version: number; opportunityId: string } | null> {
  const opportunityId = payload.opportunity_id || await findOrCreateOpportunity(payload, actor);

  const db = getDb();
  return db.transaction(async (tx) => {
    const [opp] = await tx.select().from(opportunities)
      .where(eq(opportunities.id, opportunityId)).limit(1);
    if (!opp) return null;

    const [latest] = await tx.select({ version: proposals.version })
      .from(proposals).where(eq(proposals.opportunityId, opportunityId))
      .orderBy(desc(proposals.version)).limit(1);
    const version = (latest?.version ?? 0) + 1;

    const feeRaw = payload.service_fee ?? "";
    const budget = budgetText(
      parseMoneyToCents(payload.budget_low ?? ""),
      parseMoneyToCents(payload.budget_high ?? ""),
    );
    const feeCents = toCents(computeFee(feeRaw, budget).value);

    await tx.insert(proposals).values({
      opportunityId, version,
      snapshot: payload as unknown as Record<string, unknown>,
      feeRaw, feeCents,
      generatedById: actor.id,
      sentTo: payload.client_email ?? "",
    });

    // Keep the opportunity's own figures in step with what was actually quoted.
    const resolved = computeFee(feeRaw, budget);
    await tx.update(opportunities).set({
      proposalGeneratedAt: new Date(),
      feeRaw: feeRaw || opp.feeRaw,
      proposalValueCents: toCents(resolved.value) ?? opp.proposalValueCents,
      valueEstimated: resolved.value !== null ? resolved.estimated : opp.valueEstimated,
      // Nudge the stage forward, but never drag a further-along deal backwards.
      stage: opp.stage === "new_lead" || opp.stage === "contacted" || opp.stage === "proposal_needed"
        ? "proposal_review" : opp.stage,
    }).where(eq(opportunities.id, opportunityId));

    await logActivity({
      opportunityId, type: "proposal_generated", actorId: actor.id,
      body: `Proposal version ${version} generated`,
      meta: { version, feeRaw },
    }, tx);

    return { version, opportunityId };
  });
}

/** Record that the newest version was emailed, and start follow-up tracking. */
export async function recordSent(
  payload: ProposalPayload, actor: User, sentTo: string,
  cadenceDays: number[],
): Promise<string | null> {
  // Sending straight from the generator without generating first still has to
  // produce a record — this is the moment the deal becomes real.
  const opportunityId = payload.opportunity_id || await findOrCreateOpportunity(payload, actor);

  const db = getDb();
  await db.transaction(async (tx) => {
    const [opp] = await tx.select().from(opportunities)
      .where(eq(opportunities.id, opportunityId)).limit(1);
    if (!opp) return;

    const now = new Date();
    const [latest] = await tx.select().from(proposals)
      .where(eq(proposals.opportunityId, opportunityId))
      .orderBy(desc(proposals.version)).limit(1);

    if (latest) {
      await tx.update(proposals).set({
        sentAt: now, sentTo,
        subject: payload.subject ?? "",
        body: payload.body ?? "",
      }).where(eq(proposals.id, latest.id));
    }

    // Order matters. The timeline entries go in FIRST, while follow-up is
    // still inactive: logActivity() pauses an active sequence whenever a human
    // conversation is recorded, and the proposal email would otherwise pause
    // the very sequence it is supposed to start.
    //
    // Logged as proposal_sent AND as an outbound touch, so it counts as a human
    // response for speed-to-lead if nothing earlier did.
    await logActivity({
      opportunityId, type: "proposal_sent", actorId: actor.id,
      body: `Proposal${latest ? ` version ${latest.version}` : ""} sent to ${sentTo}`,
      meta: { version: latest?.version, sentTo },
      occurredAt: now,
    }, tx);
    await logActivity({
      opportunityId, type: "email_out", actorId: actor.id,
      body: `Proposal emailed to ${sentTo}`,
      meta: { proposal: true },
      occurredAt: now,
    }, tx);

    // Now arm the follow-up sequence. The first step is due after cadence[0]
    // days; the Phase 2 cron takes it from here.
    const firstStepDays = cadenceDays[0] ?? 1;
    await tx.update(opportunities).set({
      proposalSentAt: now,
      stage: opp.stage === "won" || opp.stage === "lost" ? opp.stage : "proposal_sent",
      followupState: "active",
      followupStep: 0,
      followupDueAt: new Date(now.getTime() + firstStepDays * 86_400_000),
      followupPausedReason: "",
    }).where(eq(opportunities.id, opportunityId));
  });

  return opportunityId;
}
