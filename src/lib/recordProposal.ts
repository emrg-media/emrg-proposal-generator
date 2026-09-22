import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { opportunities, proposals, type User } from "@/db/schema";
import { logActivity } from "./activity";
import { computeFee, toCents, budgetText, parseMoneyToCents } from "./fee";

// Writing a proposal into the permanent record (brief §6). Every generated
// version is kept forever, whatever becomes of the deal, and the snapshot is
// the exact payload the PDF was rendered from — so any past proposal can be
// reproduced byte-for-byte later.

export interface ProposalPayload {
  opportunity_id?: string;
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

/** Record a generated version. Returns the version number, or null if unlinked. */
export async function recordGenerated(payload: ProposalPayload, actor: User): Promise<number | null> {
  const opportunityId = payload.opportunity_id;
  if (!opportunityId) return null;

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

    return version;
  });
}

/** Record that the newest version was emailed, and start follow-up tracking. */
export async function recordSent(
  payload: ProposalPayload, actor: User, sentTo: string,
  cadenceDays: number[],
): Promise<void> {
  const opportunityId = payload.opportunity_id;
  if (!opportunityId) return;

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
}
