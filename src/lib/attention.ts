import type { Stage } from "@/db/schema";
import { isOpen } from "./constants";

// The Needs Attention engine (brief §14).
//
// A deliberately pure function over plain rows: no database, no clock of its
// own. That makes it unit-testable, and means the Phase 2 daily email brief can
// reuse exactly the same rules the team sees on screen — there is only one
// definition of "this needs attention" in the system.

export type AttentionKind =
  | "unanswered_lead"
  | "client_waiting"
  | "awaiting_approval"
  | "next_action_overdue"
  | "followup_overdue"
  | "proposal_silent"
  | "no_next_action";

export interface AttentionInput {
  id: string;
  code: string;
  company: string;
  eventName: string;
  stage: Stage;
  ownerId: string | null;
  ownerName: string | null;
  valueCents: number | null;
  leadReceivedAt: Date;
  firstResponseAt: Date | null;
  proposalSentAt: Date | null;
  nextAction: string;
  nextActionDate: Date | null;
  approvalState: "not_required" | "waiting" | "approved";
  followupState: "inactive" | "active" | "paused" | "stopped";
  followupDueAt: Date | null;
  /** Most recent inbound message from the client, if any. */
  lastInboundAt: Date | null;
  /** Most recent outbound human touch from the team, if any. */
  lastOutboundAt: Date | null;
}

export interface AttentionItem {
  opportunityId: string;
  kind: AttentionKind;
  severity: number;
  /** One line stating what is wrong, e.g. "Unanswered for 22 minutes". */
  headline: string;
  valueCents: number | null;
  ownerId: string | null;
  ownerName: string | null;
  company: string;
  eventName: string;
  code: string;
}

export interface AttentionOptions {
  now: Date;
  responseTargetMinutes: number;
  /** Days of silence after sending before a proposal is chased. */
  proposalSilentDays?: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Base urgency per rule. Age is added on top so the oldest offender in a
// category floats up, but a category never overtakes a more urgent one.
const BASE: Record<AttentionKind, number> = {
  unanswered_lead: 1000,
  client_waiting: 800,
  awaiting_approval: 600,
  next_action_overdue: 400,
  followup_overdue: 300,
  proposal_silent: 200,
  no_next_action: 100,
};

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Humanised age: "22 minutes", "3 hours", "4 days". */
export function ageLabel(ms: number): string {
  if (ms < HOUR) return plural(Math.max(1, Math.floor(ms / MINUTE)), "minute");
  if (ms < DAY) return plural(Math.floor(ms / HOUR), "hour");
  return plural(Math.floor(ms / DAY), "day");
}

/** Traffic light for a lead still awaiting its first response. */
export function responseStatus(
  o: { leadReceivedAt: Date; firstResponseAt: Date | null },
  now: Date,
  targetMinutes: number,
): "answered" | "within" | "approaching" | "overdue" {
  if (o.firstResponseAt) return "answered";
  const elapsed = now.getTime() - o.leadReceivedAt.getTime();
  const target = targetMinutes * MINUTE;
  if (elapsed >= target) return "overdue";
  if (elapsed >= target * 0.75) return "approaching";
  return "within";
}

/**
 * Every reason this one opportunity needs a human right now. An opportunity
 * can legitimately raise more than one.
 */
export function attentionFor(o: AttentionInput, opts: AttentionOptions): AttentionItem[] {
  const { now, responseTargetMinutes } = opts;
  const silentDays = opts.proposalSilentDays ?? 3;
  const items: AttentionItem[] = [];
  const t = now.getTime();

  const add = (kind: AttentionKind, ageMs: number, headline: string) => {
    items.push({
      kind,
      // Age contributes at most ~99 so it orders within a rule, never across.
      severity: BASE[kind] + Math.min(99, Math.floor(ageMs / HOUR)),
      headline,
      opportunityId: o.id,
      valueCents: o.valueCents,
      ownerId: o.ownerId,
      ownerName: o.ownerName,
      company: o.company,
      eventName: o.eventName,
      code: o.code,
    });
  };

  // Won and lost deals are history — they never need attention.
  if (!isOpen(o.stage)) return items;

  // 1. A new lead nobody has answered, past the response target.
  if (!o.firstResponseAt) {
    const waiting = t - o.leadReceivedAt.getTime();
    if (waiting >= responseTargetMinutes * MINUTE) {
      add("unanswered_lead", waiting, `New lead unanswered for ${ageLabel(waiting)}`);
    }
  }

  // 2. The client wrote back and nobody has replied since.
  if (o.lastInboundAt && (!o.lastOutboundAt || o.lastOutboundAt < o.lastInboundAt)) {
    const waiting = t - o.lastInboundAt.getTime();
    add("client_waiting", waiting, `Client replied ${ageLabel(waiting)} ago — no response yet`);
  }

  // 3. Sitting in Erica's approval queue.
  if (o.approvalState === "waiting") {
    const waiting = t - (o.proposalSentAt ?? o.leadReceivedAt).getTime();
    add("awaiting_approval", waiting, "Waiting for Erica's approval");
  }

  // 4. A next action whose date has passed.
  if (o.nextActionDate && o.nextActionDate.getTime() < t) {
    const overdue = t - o.nextActionDate.getTime();
    add("next_action_overdue", overdue, `Next action overdue by ${ageLabel(overdue)}`);
  }

  // 5. An automated follow-up that should already have gone out. A paused
  //    sequence is deliberate and must never be flagged.
  if (o.followupState === "active" && o.followupDueAt && o.followupDueAt.getTime() < t) {
    const overdue = t - o.followupDueAt.getTime();
    add("followup_overdue", overdue, `Follow-up overdue by ${ageLabel(overdue)}`);
  }

  // 6. A proposal that went out and went quiet.
  if (o.proposalSentAt && !o.lastInboundAt) {
    const silent = t - o.proposalSentAt.getTime();
    if (silent >= silentDays * DAY) {
      add("proposal_silent", silent, `Proposal sent ${ageLabel(silent)} ago with no reply`);
    }
  }

  // 7. Nothing scheduled — the quiet way deals die.
  if (!o.nextAction.trim() && !o.nextActionDate) {
    add("no_next_action", 0, "No next action assigned");
  }

  return items;
}

/**
 * Rank every opportunity's issues into one list. Ties break on value, so when
 * two leads are equally late the bigger one is dealt with first.
 */
export function buildAttentionList(
  rows: AttentionInput[],
  opts: AttentionOptions,
): AttentionItem[] {
  return rows
    .flatMap((r) => attentionFor(r, opts))
    .sort((a, b) => b.severity - a.severity || (b.valueCents ?? 0) - (a.valueCents ?? 0));
}

/** Count per rule, for the summary strip and the daily brief. */
export function attentionCounts(items: AttentionItem[]): Record<AttentionKind, number> {
  const counts = {
    unanswered_lead: 0, client_waiting: 0, awaiting_approval: 0,
    next_action_overdue: 0, followup_overdue: 0, proposal_silent: 0, no_next_action: 0,
  } as Record<AttentionKind, number>;
  for (const i of items) counts[i.kind]++;
  return counts;
}

// ── Grouping ─────────────────────────────────────────────────────────────────

/**
 * One entry per opportunity rather than per rule.
 *
 * A single deal can legitimately trip several rules at once — unanswered AND
 * no next action, say — but listing it three times makes the page harder to
 * scan and makes any total computed from it double-count. So the most urgent
 * reason becomes the headline and the rest ride along as secondary notes.
 */
export interface AttentionGroup {
  opportunityId: string;
  code: string;
  company: string;
  eventName: string;
  valueCents: number | null;
  ownerId: string | null;
  ownerName: string | null;
  primary: AttentionItem;
  others: AttentionItem[];
  severity: number;
}

export function groupAttention(items: AttentionItem[]): AttentionGroup[] {
  const byOpportunity = new Map<string, AttentionItem[]>();
  for (const item of items) {
    const list = byOpportunity.get(item.opportunityId) ?? [];
    list.push(item);
    byOpportunity.set(item.opportunityId, list);
  }

  return [...byOpportunity.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => b.severity - a.severity);
      const [primary, ...others] = sorted;
      return {
        opportunityId: primary.opportunityId,
        code: primary.code,
        company: primary.company,
        eventName: primary.eventName,
        valueCents: primary.valueCents,
        ownerId: primary.ownerId,
        ownerName: primary.ownerName,
        primary,
        others,
        severity: primary.severity,
      };
    })
    .sort((a, b) => b.severity - a.severity || (b.valueCents ?? 0) - (a.valueCents ?? 0));
}

/** Total value at stake, counting each opportunity exactly once. */
export function totalValueAtStake(groups: AttentionGroup[]): number {
  return groups.reduce((sum, g) => sum + (g.valueCents ?? 0), 0);
}
