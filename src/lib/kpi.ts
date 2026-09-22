import type { Stage } from "@/db/schema";
import { isOpen, STAGES } from "./constants";

// Every number on Mario's executive dashboard (brief §22–24).
//
// Pure, so it can be unit-tested and reused by the Phase 2 daily brief.
//
// One distinction runs through all of it, and the UI states it plainly rather
// than letting the reader guess:
//   · PERIOD metrics count things that HAPPENED in the window — new leads,
//     proposals sent, deals won or lost.
//   · RIGHT-NOW metrics describe the CURRENT state of the business — open
//     pipeline, what is stalled, what has no next action. A date filter must
//     not change them, or "how much is in the pipeline?" becomes unanswerable.

export interface KpiInput {
  id: string;
  stage: Stage;
  ownerId: string | null;
  ownerName: string | null;
  valueCents: number | null;
  leadReceivedAt: Date;
  firstResponseAt: Date | null;
  proposalGeneratedAt: Date | null;
  proposalSentAt: Date | null;
  nextAction: string;
  nextActionDate: Date | null;
  followupState: string;
  followupDueAt: Date | null;
  wonAt: Date | null;
  lostAt: Date | null;
}

export interface KpiWindow { start: Date | null; end: Date | null }

export interface Kpis {
  // Period
  newLeads: number;
  proposalsGenerated: number;
  proposalsSent: number;
  proposalValueSentCents: number;
  wonCount: number;
  wonCents: number;
  lostCount: number;
  lostCents: number;
  winRate: number | null;          // 0..1 over decided deals in the window
  avgProposalValueCents: number | null;
  // Period — speed
  avgSpeedToLeadMs: number | null;
  answeredWithinTargetRate: number | null;
  avgLeadToProposalMs: number | null;
  avgProposalToCloseMs: number | null;
  // Right now
  openCount: number;
  openPipelineCents: number;
  byStage: Array<{ stage: Stage; count: number; cents: number }>;
  byOwner: Array<{ ownerId: string | null; ownerName: string; count: number; cents: number }>;
  leadsOutsideTarget: number;
  noNextAction: number;
  overdueFollowups: number;
  proposalAging: { d0_3: number; d4_7: number; d8_14: number; d15plus: number };
  stalledPipelineCents: number;
}

const DAY = 86_400_000;

function inWindow(d: Date | null, w: KpiWindow): boolean {
  if (!d) return false;
  if (w.start && d < w.start) return false;
  if (w.end && d > w.end) return false;
  return true;
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function computeKpis(
  rows: KpiInput[],
  window: KpiWindow,
  opts: { now: Date; responseTargetMinutes: number; stalledDays?: number },
): Kpis {
  const { now, responseTargetMinutes } = opts;
  const stalledDays = opts.stalledDays ?? 7;
  const t = now.getTime();

  // ── Period ────────────────────────────────────────────────────────────────
  const leadsInWindow = rows.filter((r) => inWindow(r.leadReceivedAt, window));
  const generatedInWindow = rows.filter((r) => inWindow(r.proposalGeneratedAt, window));
  const sentInWindow = rows.filter((r) => inWindow(r.proposalSentAt, window));
  const wonInWindow = rows.filter((r) => inWindow(r.wonAt, window));
  const lostInWindow = rows.filter((r) => inWindow(r.lostAt, window));

  const sumValue = (list: KpiInput[]) => list.reduce((s, r) => s + (r.valueCents ?? 0), 0);

  const decided = wonInWindow.length + lostInWindow.length;
  const sentValues = sentInWindow.map((r) => r.valueCents).filter((v): v is number => v !== null);

  // ── Speed, over leads that arrived in the window ──────────────────────────
  const answered = leadsInWindow.filter((r) => r.firstResponseAt);
  const speeds = answered.map((r) => r.firstResponseAt!.getTime() - r.leadReceivedAt.getTime());
  const withinTarget = speeds.filter((ms) => ms <= responseTargetMinutes * 60_000).length;

  const leadToProposal = rows
    .filter((r) => r.proposalGeneratedAt && inWindow(r.proposalGeneratedAt, window))
    .map((r) => r.proposalGeneratedAt!.getTime() - r.leadReceivedAt.getTime())
    .filter((ms) => ms >= 0);

  const proposalToClose = rows
    .filter((r) => r.proposalSentAt && (r.wonAt || r.lostAt) && inWindow(r.wonAt ?? r.lostAt, window))
    .map((r) => (r.wonAt ?? r.lostAt)!.getTime() - r.proposalSentAt!.getTime())
    .filter((ms) => ms >= 0);

  // ── Right now (deliberately ignores the window) ───────────────────────────
  const open = rows.filter((r) => isOpen(r.stage));

  const byStage = STAGES.filter(isOpen).map((stage) => {
    const list = open.filter((r) => r.stage === stage);
    return { stage, count: list.length, cents: sumValue(list) };
  });

  const ownerMap = new Map<string, { ownerId: string | null; ownerName: string; count: number; cents: number }>();
  for (const r of open) {
    const key = r.ownerId ?? "__unassigned";
    const entry = ownerMap.get(key) ?? {
      ownerId: r.ownerId, ownerName: r.ownerName ?? "Unassigned", count: 0, cents: 0,
    };
    entry.count++;
    entry.cents += r.valueCents ?? 0;
    ownerMap.set(key, entry);
  }

  const leadsOutsideTarget = open.filter(
    (r) => !r.firstResponseAt && t - r.leadReceivedAt.getTime() > responseTargetMinutes * 60_000,
  ).length;

  const noNextAction = open.filter((r) => !r.nextAction.trim() && !r.nextActionDate).length;

  const overdueFollowups = open.filter(
    (r) => r.followupState === "active" && r.followupDueAt && r.followupDueAt.getTime() < t,
  ).length;

  const awaitingReply = open.filter((r) => r.proposalSentAt);
  const agedDays = (r: KpiInput) => Math.floor((t - r.proposalSentAt!.getTime()) / DAY);
  const proposalAging = {
    d0_3: awaitingReply.filter((r) => agedDays(r) <= 3).length,
    d4_7: awaitingReply.filter((r) => { const d = agedDays(r); return d >= 4 && d <= 7; }).length,
    d8_14: awaitingReply.filter((r) => { const d = agedDays(r); return d >= 8 && d <= 14; }).length,
    d15plus: awaitingReply.filter((r) => agedDays(r) >= 15).length,
  };

  // Stalled: open, a proposal is out, and nothing has moved for a week.
  const stalledPipelineCents = sumValue(
    awaitingReply.filter((r) => agedDays(r) >= stalledDays),
  );

  return {
    newLeads: leadsInWindow.length,
    proposalsGenerated: generatedInWindow.length,
    proposalsSent: sentInWindow.length,
    proposalValueSentCents: sumValue(sentInWindow),
    wonCount: wonInWindow.length,
    wonCents: sumValue(wonInWindow),
    lostCount: lostInWindow.length,
    lostCents: sumValue(lostInWindow),
    winRate: decided > 0 ? wonInWindow.length / decided : null,
    avgProposalValueCents: mean(sentValues),
    avgSpeedToLeadMs: mean(speeds),
    answeredWithinTargetRate: speeds.length ? withinTarget / speeds.length : null,
    avgLeadToProposalMs: mean(leadToProposal),
    avgProposalToCloseMs: mean(proposalToClose),
    openCount: open.length,
    openPipelineCents: sumValue(open),
    byStage,
    byOwner: [...ownerMap.values()].sort((a, b) => b.cents - a.cents),
    leadsOutsideTarget,
    noNextAction,
    overdueFollowups,
    proposalAging,
    stalledPipelineCents,
  };
}

// ── Window helpers ───────────────────────────────────────────────────────────

export type PeriodKey = "today" | "week" | "month" | "ytd" | "custom";

export function periodWindow(
  period: PeriodKey, now: Date = new Date(), from?: string, to?: string,
): KpiWindow {
  switch (period) {
    case "today": {
      const start = new Date(now); start.setHours(0, 0, 0, 0);
      return { start, end: null };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
      start.setHours(0, 0, 0, 0);
      return { start, end: null };
    }
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: null };
    case "ytd":
      return { start: new Date(now.getFullYear(), 0, 1), end: null };
    case "custom":
      return {
        start: from ? new Date(`${from}T00:00:00`) : null,
        end: to ? new Date(`${to}T23:59:59.999`) : null,
      };
  }
}

export function fmtPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
