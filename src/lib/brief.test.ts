import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBrief, briefWindow, type BriefInput } from "./brief";
import type { Kpis } from "./kpi";
import type { AttentionGroup } from "./attention";

const NOW = new Date("2026-09-24T11:00:00Z"); // a Thursday
const APP = "https://emrg.example";

function kpis(over: Partial<Kpis> = {}): Kpis {
  return {
    newLeads: 3, proposalsGenerated: 2, proposalsSent: 2,
    proposalValueSentCents: 6_800_000,
    wonCount: 1, wonCents: 7_150_000, lostCount: 1, lostCents: 2_900_000,
    winRate: 0.5, avgProposalValueCents: 3_400_000,
    avgSpeedToLeadMs: 27 * 60_000, answeredWithinTargetRate: 0.57,
    avgLeadToProposalMs: null, avgProposalToCloseMs: null,
    openCount: 8, openPipelineCents: 37_780_000,
    byStage: [], byOwner: [],
    leadsOutsideTarget: 2, noNextAction: 3, overdueFollowups: 1,
    proposalAging: { d0_3: 1, d4_7: 1, d8_14: 0, d15plus: 1 },
    stalledPipelineCents: 9_600_000,
    ...over,
  };
}

function group(over: Partial<AttentionGroup> = {}): AttentionGroup {
  const primary = {
    opportunityId: "o1", kind: "proposal_silent" as const, severity: 200,
    headline: "Proposal sent 5 days ago with no reply", valueCents: 2_400_000,
    ownerId: "u1", ownerName: "Mary Jane", ownerColor: null,
    company: "ABC Corp", eventName: "Annual Meeting", code: "EMRG-1",
  };
  return {
    opportunityId: "o1", code: "EMRG-1", company: "ABC Corp", eventName: "Annual Meeting",
    valueCents: 2_400_000, ownerId: "u1", ownerName: "Mary Jane", ownerColor: null,
    primary, others: [], severity: 200, ...over,
  };
}

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  kpis: kpis(), attention: [group()], window: briefWindow(NOW), now: NOW,
  responseTargetMinutes: 15, appUrl: APP, ...over,
});

test("a Monday brief reaches back over the weekend", () => {
  const monday = briefWindow(new Date("2026-09-28T11:00:00"));
  assert.equal(monday.label, "since Friday");
  assert.equal(monday.start.getDay(), 5, "starts on Friday");
});

test("a midweek brief covers yesterday", () => {
  const w = briefWindow(new Date("2026-09-24T11:00:00"));
  assert.equal(w.label, "yesterday");
  assert.equal(w.start.getDate(), 23);
});

test("approvals are put in front of Mario, because only he clears them", () => {
  const waiting = group({
    opportunityId: "g", company: "Goldman Sachs", valueCents: 6_200_000,
    primary: { ...group().primary, kind: "awaiting_approval", headline: "Waiting for Erica's approval" },
  });
  const b = composeBrief(input({ attention: [waiting, group()] }));
  assert.ok(b.text.includes("NEEDS YOU"));
  const needsYou = b.text.indexOf("Goldman Sachs");
  const rest = b.text.indexOf("ABC Corp");
  assert.ok(needsYou < rest, "the thing he must act on comes first");
  assert.match(b.subject, /need/i);
});

test("an unowned opportunity also lands in front of him", () => {
  const orphan = group({ opportunityId: "x", company: "Harbour Foundation", ownerId: null, ownerName: null });
  const b = composeBrief(input({ attention: [orphan] }));
  assert.ok(b.text.includes("NEEDS YOU"));
  assert.ok(b.text.includes("Harbour Foundation"));
});

test("the state of the business is always reported", () => {
  const b = composeBrief(input());
  assert.ok(b.text.includes("RIGHT NOW"));
  assert.ok(b.text.includes("$377,800"), b.text);
  assert.ok(b.text.includes("$96,000"), "stalled money is called out");
  assert.ok(b.text.includes("past the 15 minute target"));
});

test("what moved is reported with the right period heading", () => {
  const b = composeBrief(input());
  assert.ok(b.text.includes("YESTERDAY"));
  assert.ok(b.text.includes("New leads"));
  assert.ok(b.text.includes("$71,500"), "won money");
  assert.ok(b.text.includes("27m"), "speed to lead");
});

test("zero rows are left out rather than printed as zero", () => {
  const b = composeBrief(input({
    kpis: kpis({ wonCount: 0, wonCents: 0, lostCount: 0, lostCents: 0,
                 stalledPipelineCents: 0, leadsOutsideTarget: 0, noNextAction: 0 }),
  }));
  assert.ok(!b.text.includes("Won  "), "no empty Won line");
  assert.ok(!b.text.includes("Stalled"), "no zero stalled line");
  assert.ok(!b.text.includes("Unanswered"), "no zero unanswered line");
});

test("a genuinely quiet day is three lines, not a wall of zeroes", () => {
  const b = composeBrief(input({
    attention: [],
    kpis: kpis({ newLeads: 0, proposalsSent: 0, wonCount: 0, lostCount: 0 }),
  }));
  assert.equal(b.quiet, true);
  assert.match(b.subject, /quiet/i);
  assert.ok(b.text.split("\n").filter((l) => l.trim()).length <= 6, b.text);
  assert.ok(b.text.includes("$377,800"), "still says what is open");
});

test("a long attention list is capped so the email stays readable", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    group({ opportunityId: `o${i}`, company: `Company ${i}` }));
  const b = composeBrief(input({ attention: many }));
  assert.ok(b.text.includes("and 22 more"), b.text.slice(-300));
  assert.ok(b.text.split("\n").length < 60, "still a scannable email");
});

test("it always links back to the dashboard", () => {
  const b = composeBrief(input());
  assert.ok(b.text.includes(APP));
  assert.ok(b.html.includes(APP));
});

test("the HTML escapes company names rather than trusting them", () => {
  const nasty = group({ company: "<script>alert(1)</script>" });
  const b = composeBrief(input({ attention: [nasty] }));
  assert.ok(!b.html.includes("<script>"), "a company name cannot inject markup");
  assert.ok(b.html.includes("&lt;script&gt;"));
});

test("the subject says what matters without needing the body open", () => {
  const busy = composeBrief(input({
    attention: [group({ primary: { ...group().primary, kind: "awaiting_approval" } })],
  }));
  assert.match(busy.subject, /1 needs you/);

  const calm = composeBrief(input({ attention: [group()] }));
  assert.match(calm.subject, /\$377,800 open, 3 new/);
});
