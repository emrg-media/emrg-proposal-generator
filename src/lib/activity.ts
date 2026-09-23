import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, opportunities, type ActivityType } from "@/db/schema";
import { HUMAN_TOUCH_TYPES, CONVERSATION_TYPES } from "./constants";

// Everything that happens to an opportunity goes through logActivity(). It
// writes the timeline row and, in the same transaction, derives the fields the
// dashboards read — so the timeline and the numbers can never disagree.
//
// Derived here rather than typed by a human:
//   · lastActivityAt / lastTouchedById  — "is anyone working this?"
//   · firstResponseAt                   — the clock behind speed-to-lead (§13)
//   · lastContactAt                     — real two-way contact
//   · follow-up pausing                 — human takeover (§17)

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type Executor = Db | Tx;

export interface LogActivityInput {
  opportunityId: string;
  type: ActivityType;
  actorId?: string | null;
  body?: string;
  meta?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Append to the timeline and roll the derived fields forward.
 * Pass `exec` to join an existing transaction; otherwise one is opened.
 */
export async function logActivity(input: LogActivityInput, exec?: Executor): Promise<void> {
  if (exec) return writeActivity(exec, input);
  return getDb().transaction((tx) => writeActivity(tx, input));
}

/** Several activities at once, in one transaction and in the given order. */
export async function logActivities(inputs: LogActivityInput[], exec?: Executor): Promise<void> {
  const run = async (e: Executor) => {
    for (const input of inputs) await writeActivity(e, input);
  };
  if (exec) return run(exec);
  return getDb().transaction(run);
}

async function writeActivity(exec: Executor, input: LogActivityInput): Promise<void> {
  const at = input.occurredAt ?? new Date();
  const { opportunityId, type, actorId = null } = input;

  await exec.insert(activities).values({
    opportunityId,
    type,
    actorId,
    body: input.body ?? "",
    meta: input.meta ?? {},
    occurredAt: at,
  });

  const [opp] = await exec.select().from(opportunities)
    .where(eq(opportunities.id, opportunityId)).limit(1);
  if (!opp) return;

  const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date() };

  // Never let an out-of-order backfill drag "last activity" backwards.
  if (at > opp.lastActivityAt) patch.lastActivityAt = at;
  if (actorId) patch.lastTouchedById = actorId;

  // Speed to lead: the first genuine human touch stops the clock. Only ever
  // set once — a later email must not overwrite the original response time.
  if (!opp.firstResponseAt && HUMAN_TOUCH_TYPES.includes(type)) {
    patch.firstResponseAt = at;
  }

  if (CONVERSATION_TYPES.includes(type)) {
    if (!opp.lastContactAt || at > opp.lastContactAt) patch.lastContactAt = at;

    // Human takeover: a real conversation is happening, so the automated
    // sequence steps aside rather than talking over the team (brief §17).
    if (opp.followupState === "active") {
      patch.followupState = "paused";
      patch.followupPausedReason = "Human conversation active";
      patch.followupResumeAt = null;

      // Recorded directly, not via logActivity, so it cannot re-trigger itself.
      await exec.insert(activities).values({
        opportunityId,
        type: "followup_paused",
        actorId,
        body: "Follow-up paused, human conversation active",
        meta: { auto: true, trigger: type },
        occurredAt: at,
      });
    }
  }

  await exec.update(opportunities).set(patch).where(eq(opportunities.id, opportunityId));
}

// Re-exported so server code has one import for "activity things"; the
// implementations live in lib/time.ts because client components need them too
// and must not pull the database driver into the browser bundle.
export { speedToLeadMs, formatDuration } from "./time";
