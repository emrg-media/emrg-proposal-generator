import { test } from "node:test";
import assert from "node:assert/strict";
import { computeKpis, periodWindow, fmtPercent, type KpiInput } from "./kpi";

const NOW = new Date("2026-09-21T12:00:00Z");
const DAY = 86_400_000, MIN = 60_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const OPTS = { now: NOW, responseTargetMinutes: 15 };

function row(over: Partial<KpiInput> = {}): KpiInput {
  return {
    id: Math.random().toString(36).slice(2),
    stage: "contacted", ownerId: "u1", ownerName: "Victoria", valueCents: 1_000_000,
    leadReceivedAt: ago(DAY), firstResponseAt: ago(DAY - 5 * MIN),
    proposalGeneratedAt: null, proposalSentAt: null,
    nextAction: "Call", nextActionDate: new Date(NOW.getTime() + DAY),
    followupState: "inactive", followupDueAt: null, wonAt: null, lostAt: null,
    ...over,
  };
}

const ALL = { start: null, end: null };

test("open pipeline counts only open stages", () => {
  const k = computeKpis([
    row({ stage: "contacted", valueCents: 1_000_000 }),
    row({ stage: "proposal_sent", valueCents: 2_000_000, proposalSentAt: ago(DAY) }),
    row({ stage: "won", valueCents: 9_000_000, wonAt: ago(DAY) }),
    row({ stage: "lost", valueCents: 9_000_000, lostAt: ago(DAY) }),
  ], ALL, OPTS);
  assert.equal(k.openCount, 2);
  assert.equal(k.openPipelineCents, 3_000_000);
});

test("won and lost totals are counted over the window", () => {
  const k = computeKpis([
    row({ stage: "won", valueCents: 5_000_000, wonAt: ago(2 * DAY) }),
    row({ stage: "won", valueCents: 3_000_000, wonAt: ago(40 * DAY) }),
    row({ stage: "lost", valueCents: 1_000_000, lostAt: ago(2 * DAY) }),
  ], { start: ago(7 * DAY), end: null }, OPTS);
  assert.equal(k.wonCount, 1, "the 40-day-old win is outside the week");
  assert.equal(k.wonCents, 5_000_000);
  assert.equal(k.lostCount, 1);
  assert.equal(k.lostCents, 1_000_000);
  assert.equal(k.winRate, 0.5);
});

test("win rate is null when nothing was decided", () => {
  assert.equal(computeKpis([row()], ALL, OPTS).winRate, null);
});

test("open pipeline ignores the date window entirely", () => {
  // A deal from two years ago is still money in the pipeline today.
  const rows = [row({ stage: "contacted", valueCents: 4_000_000, leadReceivedAt: ago(700 * DAY) })];
  const windowed = computeKpis(rows, { start: ago(DAY), end: null }, OPTS);
  assert.equal(windowed.openPipelineCents, 4_000_000);
  assert.equal(windowed.newLeads, 0, "but it is not a NEW lead in that window");
});

test("average speed to lead only counts answered leads", () => {
  const k = computeKpis([
    row({ leadReceivedAt: ago(DAY), firstResponseAt: ago(DAY - 10 * MIN) }),
    row({ leadReceivedAt: ago(DAY), firstResponseAt: ago(DAY - 20 * MIN) }),
    row({ leadReceivedAt: ago(DAY), firstResponseAt: null, stage: "new_lead" }),
  ], ALL, OPTS);
  assert.equal(k.avgSpeedToLeadMs, 15 * MIN);
  assert.equal(k.answeredWithinTargetRate, 0.5, "10m is within 15, 20m is not");
});

test("speed metrics are null with nothing to average", () => {
  const k = computeKpis([row({ firstResponseAt: null, stage: "new_lead" })], ALL, OPTS);
  assert.equal(k.avgSpeedToLeadMs, null);
  assert.equal(k.answeredWithinTargetRate, null);
});

test("proposal aging buckets split at the stated boundaries", () => {
  const sent = (days: number) => row({ stage: "proposal_sent", proposalSentAt: ago(days * DAY) });
  const k = computeKpis([sent(0), sent(3), sent(4), sent(7), sent(8), sent(14), sent(15), sent(40)], ALL, OPTS);
  assert.deepEqual(k.proposalAging, { d0_3: 2, d4_7: 2, d8_14: 2, d15plus: 2 });
});

test("closed deals drop out of the aging buckets", () => {
  const k = computeKpis([
    row({ stage: "won", proposalSentAt: ago(20 * DAY), wonAt: ago(DAY) }),
    row({ stage: "proposal_sent", proposalSentAt: ago(20 * DAY) }),
  ], ALL, OPTS);
  assert.equal(k.proposalAging.d15plus, 1);
});

test("stalled pipeline is open proposals quiet for a week or more", () => {
  const k = computeKpis([
    row({ stage: "proposal_sent", proposalSentAt: ago(2 * DAY), valueCents: 1_000_000 }),
    row({ stage: "proposal_sent", proposalSentAt: ago(9 * DAY), valueCents: 6_000_000 }),
    row({ stage: "won", proposalSentAt: ago(30 * DAY), valueCents: 9_000_000, wonAt: ago(DAY) }),
  ], ALL, OPTS);
  assert.equal(k.stalledPipelineCents, 6_000_000);
});

test("risk counts pick up unanswered, actionless and overdue deals", () => {
  const k = computeKpis([
    row({ stage: "new_lead", firstResponseAt: null, leadReceivedAt: ago(60 * MIN) }),
    row({ nextAction: "  ", nextActionDate: null }),
    row({ followupState: "active", followupDueAt: ago(2 * DAY) }),
    row({ followupState: "paused", followupDueAt: ago(9 * DAY) }),
  ], ALL, OPTS);
  assert.equal(k.leadsOutsideTarget, 1);
  assert.equal(k.noNextAction, 1);
  assert.equal(k.overdueFollowups, 1, "a paused sequence is not overdue");
});

test("pipeline splits by owner, with unassigned called out", () => {
  const k = computeKpis([
    row({ ownerId: "u1", ownerName: "Victoria", valueCents: 3_000_000 }),
    row({ ownerId: "u1", ownerName: "Victoria", valueCents: 2_000_000 }),
    row({ ownerId: null, ownerName: null, valueCents: 7_000_000 }),
  ], ALL, OPTS);
  assert.equal(k.byOwner[0].ownerName, "Unassigned", "sorted by value");
  assert.equal(k.byOwner[0].cents, 7_000_000);
  const victoria = k.byOwner.find((o) => o.ownerName === "Victoria")!;
  assert.equal(victoria.count, 2);
  assert.equal(victoria.cents, 5_000_000);
});

test("byStage covers every open stage, including empty ones", () => {
  const k = computeKpis([row({ stage: "contacted" })], ALL, OPTS);
  assert.equal(k.byStage.length, 7, "seven open stages; won and lost excluded");
  assert.ok(k.byStage.every((s) => s.stage !== "won" && s.stage !== "lost"));
  assert.equal(k.byStage.find((s) => s.stage === "contacted")!.count, 1);
});

test("average proposal value ignores deals with no value", () => {
  const k = computeKpis([
    row({ proposalSentAt: ago(DAY), valueCents: 2_000_000 }),
    row({ proposalSentAt: ago(DAY), valueCents: 4_000_000 }),
    row({ proposalSentAt: ago(DAY), valueCents: null }),
  ], ALL, OPTS);
  assert.equal(k.avgProposalValueCents, 3_000_000);
  assert.equal(k.proposalsSent, 3, "but all three were still sent");
});

test("an empty database produces zeroes and nulls, never NaN", () => {
  const k = computeKpis([], ALL, OPTS);
  assert.equal(k.openPipelineCents, 0);
  assert.equal(k.newLeads, 0);
  assert.equal(k.winRate, null);
  assert.equal(k.avgSpeedToLeadMs, null);
  assert.equal(k.avgProposalValueCents, null);
  assert.equal(k.stalledPipelineCents, 0);
});

test("period windows start where they should", () => {
  const monday = periodWindow("week", new Date("2026-09-24T15:00:00"));
  assert.equal(monday.start!.getDay(), 1, "weeks start on Monday");
  assert.equal(periodWindow("month", NOW).start!.getDate(), 1);
  assert.equal(periodWindow("ytd", NOW).start!.getMonth(), 0);
  const custom = periodWindow("custom", NOW, "2026-01-05", "2026-02-10");
  assert.equal(custom.start!.getFullYear(), 2026);
  assert.equal(custom.end!.getHours(), 23, "the end day is included in full");
});

test("percentages format, and an unknown rate renders as nothing", () => {
  assert.equal(fmtPercent(0.5), "50%");
  assert.equal(fmtPercent(1), "100%");
  // Blank rather than a placeholder glyph: an empty cell reads as "no data"
  // without putting a stray mark in front of the reader.
  assert.equal(fmtPercent(null), "");
});
