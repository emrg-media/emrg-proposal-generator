import "server-only";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activities, opportunities, opportunityCollaborators, proposals, users,
  type Opportunity, type Stage, type LostReason, type User,
} from "@/db/schema";
import { logActivity, type Executor } from "./activity";
import { computeFee, toCents, budgetText } from "./fee";
import type { AttentionInput } from "./attention";
import { buildOwnerColors } from "./colors";
import { checkCompleteness } from "./completeness";

// Read and write helpers for opportunities. Every mutation goes through here so
// that the timeline, the derived timestamps and the resolved money value all
// stay in step — callers never write to the table directly.

export interface OpportunityRow extends Opportunity {
  ownerName: string | null;
  /** The owner's assigned colour, so every screen paints a person the same. */
  ownerColor: string | null;
  collaboratorNames: string[];
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
}

/** Human-facing ID shared with the proposal PDF, e.g. EMRG-20260921-A4F2. */
export function newOpportunityCode(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `EMRG-${ymd}-${rand}`;
}

/**
 * Resolve the quoted fee into the stored dollar value. Percentages need the
 * budget, so this must run whenever either the fee or the budget changes.
 */
export function resolveValue(feeRaw: string, budgetLowCents: number | null, budgetHighCents: number | null) {
  const calc = computeFee(feeRaw, budgetText(budgetLowCents, budgetHighCents));
  return { proposalValueCents: toCents(calc.value), valueEstimated: calc.estimated };
}

// ── Reads ────────────────────────────────────────────────────────────────────

// Last inbound / last outbound per opportunity, computed in SQL rather than by
// pulling the whole activity table into memory. Needs Attention depends on
// these to tell "the client is waiting on us" from "we are waiting on them".
const contactTimesSql = sql`
  (select
     ${activities.opportunityId} as opportunity_id,
     max(${activities.occurredAt}) filter (where ${activities.type} = 'email_in') as last_inbound,
     max(${activities.occurredAt}) filter (where ${activities.type} in ('email_out','call','meeting')) as last_outbound
   from ${activities}
   group by ${activities.opportunityId})
`;

export async function listOpportunities(opts: { stages?: Stage[] } = {}): Promise<OpportunityRow[]> {
  const db = getDb();
  const where = opts.stages?.length ? inArray(opportunities.stage, opts.stages) : undefined;

  const rows = await db
    .select({
      opp: opportunities,
      ownerName: users.name,
      lastInboundAt: sql<Date | null>`ct.last_inbound`,
      lastOutboundAt: sql<Date | null>`ct.last_outbound`,
    })
    .from(opportunities)
    .leftJoin(users, eq(users.id, opportunities.ownerId))
    .leftJoin(sql`${contactTimesSql} as ct`, sql`ct.opportunity_id = ${opportunities.id}`)
    .where(where)
    .orderBy(desc(opportunities.lastActivityAt));

  const [collaborators, colors] = await Promise.all([
    collaboratorsByOpportunity(rows.map((r) => r.opp.id)),
    ownerColorMap(),
  ]);

  return rows.map((r) => ({
    ...r.opp,
    ownerName: r.ownerName,
    ownerColor: r.opp.ownerId ? colors[r.opp.ownerId] ?? null : null,
    collaboratorNames: collaborators.get(r.opp.id) ?? [],
    lastInboundAt: r.lastInboundAt ? new Date(r.lastInboundAt) : null,
    lastOutboundAt: r.lastOutboundAt ? new Date(r.lastOutboundAt) : null,
  }));
}

async function collaboratorsByOpportunity(ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await getDb()
    .select({ opportunityId: opportunityCollaborators.opportunityId, name: users.name })
    .from(opportunityCollaborators)
    .innerJoin(users, eq(users.id, opportunityCollaborators.userId))
    .where(inArray(opportunityCollaborators.opportunityId, ids));
  for (const r of rows) {
    const list = map.get(r.opportunityId) ?? [];
    list.push(r.name);
    map.set(r.opportunityId, list);
  }
  return map;
}

export async function getOpportunity(id: string) {
  const db = getDb();
  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!opp) return null;

  const [timeline, collaboratorRows, proposalRows, owner] = await Promise.all([
    db.select({ activity: activities, actorName: users.name })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.actorId))
      .where(eq(activities.opportunityId, id))
      .orderBy(desc(activities.occurredAt)),
    db.select({ userId: opportunityCollaborators.userId, name: users.name })
      .from(opportunityCollaborators)
      .innerJoin(users, eq(users.id, opportunityCollaborators.userId))
      .where(eq(opportunityCollaborators.opportunityId, id)),
    db.select().from(proposals).where(eq(proposals.opportunityId, id)).orderBy(desc(proposals.version)),
    opp.ownerId
      ? db.select().from(users).where(eq(users.id, opp.ownerId)).limit(1)
      : Promise.resolve([]),
  ]);

  return {
    opportunity: opp,
    owner: owner[0] ?? null,
    timeline,
    collaborators: collaboratorRows,
    proposals: proposalRows,
  };
}

/** Shape rows for the Needs Attention engine. */
export function toAttentionInput(r: OpportunityRow): AttentionInput {
  return {
    id: r.id,
    code: r.code,
    company: r.company,
    eventName: r.eventName || r.eventTypes.join(" / "),
    stage: r.stage,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    ownerColor: r.ownerColor,
    valueCents: r.proposalValueCents,
    leadReceivedAt: r.leadReceivedAt,
    firstResponseAt: r.firstResponseAt,
    proposalSentAt: r.proposalSentAt,
    nextAction: r.nextAction,
    nextActionDate: r.nextActionDate,
    approvalState: r.approvalState,
    followupState: r.followupState,
    followupDueAt: r.followupDueAt,
    lastInboundAt: r.lastInboundAt,
    lastOutboundAt: r.lastOutboundAt,
    blockingGaps: checkCompleteness(r).blocking.map((m) => m.label),
  };
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface CreateOpportunityInput {
  company?: string; firstName?: string; lastName?: string; title?: string;
  email?: string; cellPhone?: string; address?: string; city?: string;
  state?: string; zip?: string; website?: string;
  leadSource?: string; leadReceivedAt?: Date; rawIntake?: Record<string, unknown>;
  eventName?: string; eventTypes?: string[]; eventDate?: string; guestCount?: string;
  venue?: string; requestedServices?: string[]; notes?: string;
  feeRaw?: string; budgetLowCents?: number | null; budgetHighCents?: number | null;
  ownerId?: string | null; collaboratorIds?: string[];
  stage?: Stage; nextAction?: string; nextActionDate?: Date | null;
}

export async function createOpportunity(input: CreateOpportunityInput, actor: User): Promise<Opportunity> {
  const db = getDb();
  const { proposalValueCents, valueEstimated } = resolveValue(
    input.feeRaw ?? "", input.budgetLowCents ?? null, input.budgetHighCents ?? null);

  return db.transaction(async (tx) => {
    const leadReceivedAt = input.leadReceivedAt ?? new Date();
    const [opp] = await tx.insert(opportunities).values({
      code: newOpportunityCode(),
      company: input.company ?? "",
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      title: input.title ?? "",
      email: input.email ?? "",
      cellPhone: input.cellPhone ?? "",
      address: input.address ?? "",
      city: input.city ?? "",
      state: input.state ?? "",
      zip: input.zip ?? "",
      website: input.website ?? "",
      leadSource: input.leadSource ?? "",
      leadReceivedAt,
      rawIntake: input.rawIntake ?? {},
      eventName: input.eventName ?? "",
      eventTypes: input.eventTypes ?? [],
      eventDate: input.eventDate ?? "",
      guestCount: input.guestCount ?? "",
      venue: input.venue ?? "",
      requestedServices: input.requestedServices ?? [],
      notes: input.notes ?? "",
      feeRaw: input.feeRaw ?? "",
      budgetLowCents: input.budgetLowCents ?? null,
      budgetHighCents: input.budgetHighCents ?? null,
      proposalValueCents,
      valueEstimated,
      ownerId: input.ownerId ?? null,
      createdById: actor.id,
      lastTouchedById: actor.id,
      stage: input.stage ?? "new_lead",
      nextAction: input.nextAction ?? "",
      nextActionDate: input.nextActionDate ?? null,
      lastActivityAt: leadReceivedAt,
    }).returning();

    if (input.collaboratorIds?.length) {
      await tx.insert(opportunityCollaborators).values(
        [...new Set(input.collaboratorIds)].map((userId) => ({ opportunityId: opp.id, userId })),
      );
    }

    // The lead arriving is itself a system event — it starts the speed clock,
    // so it is dated from when the lead came in, not when someone typed it up.
    await logActivity({
      opportunityId: opp.id,
      type: "lead_received",
      actorId: null,
      body: input.leadSource ? `Lead received via ${input.leadSource}` : "Lead received",
      meta: { enteredBy: actor.name },
      occurredAt: leadReceivedAt,
    }, tx);

    return opp;
  });
}

/** Fields a user may edit directly. */
export type EditableFields = Partial<Pick<Opportunity,
  | "company" | "firstName" | "lastName" | "title" | "email" | "cellPhone"
  | "address" | "city" | "state" | "zip" | "website" | "leadSource"
  | "eventName" | "eventTypes" | "eventDate" | "guestCount" | "venue"
  | "requestedServices" | "notes" | "feeRaw" | "budgetLowCents" | "budgetHighCents"
  | "nextAction" | "nextActionDate" | "nextActionOwnerId"
>>;

export async function updateOpportunity(id: string, patch: EditableFields, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!before) throw new Error("Opportunity not found.");

    const next = { ...patch } as Record<string, unknown>;

    // The stored dollar value is derived, so re-resolve it whenever any of its
    // inputs move — otherwise a budget edit would silently stale the pipeline.
    if ("feeRaw" in patch || "budgetLowCents" in patch || "budgetHighCents" in patch) {
      const resolved = resolveValue(
        patch.feeRaw ?? before.feeRaw,
        patch.budgetLowCents !== undefined ? patch.budgetLowCents : before.budgetLowCents,
        patch.budgetHighCents !== undefined ? patch.budgetHighCents : before.budgetHighCents,
      );
      Object.assign(next, resolved);
    }

    const changed = Object.keys(patch).filter((k) => {
      const a = (before as Record<string, unknown>)[k];
      const b = (patch as Record<string, unknown>)[k];
      return JSON.stringify(a) !== JSON.stringify(b);
    });
    if (changed.length === 0) return;

    await tx.update(opportunities).set(next).where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "field_change", actorId: actor.id,
      body: `Updated ${changed.join(", ")}`,
      meta: { fields: changed },
    }, tx);
  });
}

export async function changeStage(id: string, stage: Stage, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!before || before.stage === stage) return;

    await tx.update(opportunities).set({ stage }).where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "stage_change", actorId: actor.id,
      body: `Moved to ${stage.replace(/_/g, " ")}`,
      meta: { from: before.stage, to: stage },
    }, tx);
  });
}

export async function setOwner(id: string, ownerId: string | null, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const [before] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!before || before.ownerId === ownerId) return;

    const [owner] = ownerId
      ? await tx.select().from(users).where(eq(users.id, ownerId)).limit(1)
      : [null];

    await tx.update(opportunities).set({ ownerId }).where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "owner_change", actorId: actor.id,
      body: owner ? `Owner set to ${owner.name}` : "Owner cleared",
      meta: { from: before.ownerId, to: ownerId },
    }, tx);
  });
}

export async function setCollaborators(id: string, userIds: string[], actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(opportunityCollaborators).where(eq(opportunityCollaborators.opportunityId, id));
    const unique = [...new Set(userIds)];
    if (unique.length) {
      await tx.insert(opportunityCollaborators).values(
        unique.map((userId) => ({ opportunityId: id, userId })),
      );
    }
    await logActivity({
      opportunityId: id, type: "field_change", actorId: actor.id,
      body: unique.length ? `Collaborators updated (${unique.length})` : "Collaborators cleared",
      meta: { collaboratorIds: unique },
    }, tx);
  });
}

export async function markWon(id: string, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(opportunities).set({
      stage: "won", wonAt: new Date(), lostAt: null, lostReason: null, lostNote: "",
      followupState: "stopped",
    }).where(eq(opportunities.id, id));
    await logActivity({ opportunityId: id, type: "won", actorId: actor.id, body: "Marked won" }, tx);
  });
}

/** A reason is required (brief §18) — lost records are kept, never deleted. */
export async function markLost(id: string, reason: LostReason, note: string, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(opportunities).set({
      stage: "lost", lostAt: new Date(), lostReason: reason, lostNote: note, wonAt: null,
      followupState: "stopped",
    }).where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "lost", actorId: actor.id,
      body: `Marked lost, reason: ${reason.replace(/_/g, " ")}${note ? `. ${note}` : ""}`,
      meta: { reason, note },
    }, tx);
  });
}

export async function requestApproval(id: string, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(opportunities)
      .set({ approvalState: "waiting", stage: "proposal_review" })
      .where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "approval_requested", actorId: actor.id,
      body: "Sent to Erica for approval",
    }, tx);
  });
}

export async function approveProposal(id: string, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(opportunities)
      .set({ approvalState: "approved", approvedById: actor.id, approvedAt: new Date() })
      .where(eq(opportunities.id, id));
    await logActivity({
      opportunityId: id, type: "approved", actorId: actor.id,
      body: `Approved by ${actor.name}`,
    }, tx);
  });
}

// ── Follow-up control (brief §17) ────────────────────────────────────────────

export type FollowupCommand =
  | { action: "resume_now" }
  | { action: "resume_on"; date: Date }
  | { action: "stay_paused" }
  | { action: "stop" };

export async function controlFollowup(id: string, cmd: FollowupCommand, actor: User): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    switch (cmd.action) {
      case "resume_now":
        await tx.update(opportunities).set({
          followupState: "active", followupPausedReason: "",
          followupResumeAt: null, followupDueAt: new Date(),
        }).where(eq(opportunities.id, id));
        await logActivity({ opportunityId: id, type: "followup_resumed", actorId: actor.id, body: "Follow-up resumed" }, tx);
        break;
      case "resume_on":
        await tx.update(opportunities).set({
          followupState: "active", followupPausedReason: "",
          followupResumeAt: cmd.date, followupDueAt: cmd.date,
        }).where(eq(opportunities.id, id));
        await logActivity({
          opportunityId: id, type: "followup_resumed", actorId: actor.id,
          body: `Follow-up resumes ${cmd.date.toDateString()}`, meta: { resumeAt: cmd.date.toISOString() },
        }, tx);
        break;
      case "stay_paused":
        await tx.update(opportunities).set({ followupState: "paused", followupResumeAt: null })
          .where(eq(opportunities.id, id));
        break;
      case "stop":
        await tx.update(opportunities).set({
          followupState: "stopped", followupResumeAt: null, followupDueAt: null,
        }).where(eq(opportunities.id, id));
        await logActivity({ opportunityId: id, type: "followup_paused", actorId: actor.id, body: "Follow-up stopped" }, tx);
        break;
    }
  });
}

/**
 * How many records came from the sample-data script.
 *
 * Seeded records are tagged in rawIntake so the app can say plainly that it is
 * showing samples. Without it, "Google — $85,000" on a demo looks like real
 * committed pipeline, which is a confusing thing to put in front of anyone.
 * Returns 0 once `npm run db:demo -- wipe` has been run, and the banner
 * disappears on its own.
 */
export async function countSampleRecords(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(opportunities)
    .where(sql`${opportunities.rawIntake} ->> 'demo' = 'true'`);
  return row?.n ?? 0;
}

/**
 * userId -> colour for the whole team, ordered oldest account first so the
 * assignment never shifts when somebody is added or deactivated.
 */
export async function ownerColorMap(): Promise<Record<string, string>> {
  const rows = await getDb()
    .select({ id: users.id })
    .from(users)
    .orderBy(users.createdAt, users.id);
  return buildOwnerColors(rows.map((r) => r.id));
}

export async function listUsers(): Promise<User[]> {
  return getDb().select().from(users).where(eq(users.active, true)).orderBy(users.name);
}

export type { Executor };
