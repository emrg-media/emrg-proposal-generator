import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attentionFor, buildAttentionList, attentionCounts, responseStatus, ageLabel,
  groupAttention, totalValueAtStake,
  type AttentionInput, type AttentionKind,
} from "./attention";

const NOW = new Date("2026-09-21T12:00:00Z");
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const OPTS = { now: NOW, responseTargetMinutes: 15 };

function opp(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    id: "o1", code: "EMRG-1", company: "Acme", eventName: "Holiday Party",
    stage: "contacted", ownerId: "u1", ownerName: "Victoria", ownerColor: "#2a78d6", valueCents: 5_000_000,
    leadReceivedAt: ago(5 * MIN),
    firstResponseAt: ago(4 * MIN),
    proposalSentAt: null,
    nextAction: "Call back", nextActionDate: new Date(NOW.getTime() + DAY),
    approvalState: "not_required", followupState: "inactive", followupDueAt: null,
    lastInboundAt: null, lastOutboundAt: ago(4 * MIN), blockingGaps: [],
    ...over,
  };
}

const kinds = (o: AttentionInput): AttentionKind[] =>
  attentionFor(o, OPTS).map((i) => i.kind);

test("a healthy, recently touched opportunity raises nothing", () => {
  assert.deepEqual(kinds(opp()), []);
});

test("an unanswered lead only fires once past the target", () => {
  assert.deepEqual(kinds(opp({ firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(14 * MIN) })), []);
  assert.deepEqual(kinds(opp({ firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(16 * MIN) })), ["unanswered_lead"]);
});

test("the unanswered headline reads like the brief's example", () => {
  const [item] = attentionFor(
    opp({ firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(22 * MIN) }), OPTS);
  assert.equal(item.headline, "New lead unanswered for 22 minutes");
});

test("a client reply with no response since flags client_waiting", () => {
  assert.ok(kinds(opp({ lastInboundAt: ago(2 * HOUR), lastOutboundAt: ago(3 * HOUR) })).includes("client_waiting"));
});

test("replying after the client clears client_waiting", () => {
  assert.ok(!kinds(opp({ lastInboundAt: ago(3 * HOUR), lastOutboundAt: ago(1 * HOUR) })).includes("client_waiting"));
});

test("a proposal awaiting approval is flagged", () => {
  assert.ok(kinds(opp({ approvalState: "waiting" })).includes("awaiting_approval"));
});

test("an overdue next action is flagged, a future one is not", () => {
  assert.ok(kinds(opp({ nextActionDate: ago(2 * DAY) })).includes("next_action_overdue"));
  assert.ok(!kinds(opp({ nextActionDate: new Date(NOW.getTime() + DAY) })).includes("next_action_overdue"));
});

test("an empty next action is flagged", () => {
  assert.ok(kinds(opp({ nextAction: "  ", nextActionDate: null })).includes("no_next_action"));
});

test("a silent proposal is chased only after the quiet period", () => {
  assert.ok(!kinds(opp({ proposalSentAt: ago(2 * DAY), stage: "proposal_sent" })).includes("proposal_silent"));
  assert.ok(kinds(opp({ proposalSentAt: ago(4 * DAY), stage: "proposal_sent" })).includes("proposal_silent"));
});

test("a proposal the client already replied to is not 'silent'", () => {
  assert.ok(!kinds(opp({
    proposalSentAt: ago(9 * DAY), stage: "proposal_sent", lastInboundAt: ago(DAY), lastOutboundAt: ago(HOUR),
  })).includes("proposal_silent"));
});

test("a PAUSED follow-up is never nagged about — that is the point of pausing", () => {
  assert.ok(!kinds(opp({ followupState: "paused", followupDueAt: ago(5 * DAY) })).includes("followup_overdue"));
  assert.ok(kinds(opp({ followupState: "active", followupDueAt: ago(5 * DAY) })).includes("followup_overdue"));
});

test("won and lost deals drop out entirely, however broken they look", () => {
  const broken = { firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(30 * DAY), nextAction: "", nextActionDate: null };
  assert.deepEqual(kinds(opp({ ...broken, stage: "won" })), []);
  assert.deepEqual(kinds(opp({ ...broken, stage: "lost" })), []);
  assert.ok(kinds(opp({ ...broken, stage: "new_lead" })).length > 0);
});

test("one opportunity can raise several issues at once", () => {
  const k = kinds(opp({
    firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(3 * HOUR),
    nextAction: "", nextActionDate: null, approvalState: "waiting",
  }));
  assert.ok(k.includes("unanswered_lead"));
  assert.ok(k.includes("awaiting_approval"));
  assert.ok(k.includes("no_next_action"));
});

test("ranking puts an unanswered lead above a merely missing next action", () => {
  const list = buildAttentionList([
    opp({ id: "quiet", nextAction: "", nextActionDate: null }),
    opp({ id: "urgent", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(40 * MIN) }),
  ], OPTS);
  assert.equal(list[0].opportunityId, "urgent");
  assert.equal(list[0].kind, "unanswered_lead");
});

test("age never lets a lesser rule overtake a more urgent one", () => {
  const list = buildAttentionList([
    opp({ id: "ancient", nextAction: "", nextActionDate: null, leadReceivedAt: ago(400 * DAY) }),
    opp({ id: "fresh", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(16 * MIN) }),
  ], OPTS);
  assert.equal(list[0].opportunityId, "fresh");
});

test("equally urgent leads are ordered by value", () => {
  const late = { firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(30 * MIN) };
  const list = buildAttentionList([
    opp({ id: "small", ...late, valueCents: 1_000_000 }),
    opp({ id: "big", ...late, valueCents: 8_500_000 }),
  ], OPTS);
  assert.equal(list[0].opportunityId, "big");
});

test("counts summarise the list by rule", () => {
  const counts = attentionCounts(buildAttentionList([
    opp({ id: "a", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(40 * MIN) }),
    opp({ id: "b", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(50 * MIN) }),
    opp({ id: "c", approvalState: "waiting" }),
  ], OPTS));
  assert.equal(counts.unanswered_lead, 2);
  assert.equal(counts.awaiting_approval, 1);
  assert.equal(counts.proposal_silent, 0);
});

test("response status moves through within -> approaching -> overdue", () => {
  const r = (mins: number) => responseStatus({ leadReceivedAt: ago(mins * MIN), firstResponseAt: null }, NOW, 15);
  assert.equal(r(1), "within");
  assert.equal(r(10), "within");
  assert.equal(r(12), "approaching"); // 75% of 15 = 11.25
  assert.equal(r(20), "overdue");
  assert.equal(responseStatus({ leadReceivedAt: ago(99 * MIN), firstResponseAt: ago(MIN) }, NOW, 15), "answered");
});

test("age labels round down and pluralise", () => {
  assert.equal(ageLabel(MIN), "1 minute");
  assert.equal(ageLabel(22 * MIN), "22 minutes");
  assert.equal(ageLabel(3 * HOUR), "3 hours");
  assert.equal(ageLabel(4 * DAY), "4 days");
  assert.equal(ageLabel(1 * DAY), "1 day");
  assert.equal(ageLabel(30_000), "1 minute"); // never "0 minutes"
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("an opportunity tripping several rules becomes ONE row", () => {
  const items = buildAttentionList([opp({
    id: "multi", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(2 * HOUR),
    nextAction: "", nextActionDate: null, approvalState: "waiting",
  })], OPTS);
  assert.equal(items.length, 3, "three separate rules fire");

  const groups = groupAttention(items);
  assert.equal(groups.length, 1, "but they collapse to one row");
  assert.equal(groups[0].primary.kind, "unanswered_lead", "most urgent leads");
  assert.equal(groups[0].others.length, 2);
});

test("value at stake counts each opportunity once, not once per rule", () => {
  const items = buildAttentionList([opp({
    id: "multi", valueCents: 8_500_000,
    firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(2 * HOUR),
    nextAction: "", nextActionDate: null,
  })], OPTS);
  // Summing raw items would double-count to 17,000,000.
  assert.equal(items.reduce((s, i) => s + (i.valueCents ?? 0), 0), 17_000_000);
  assert.equal(totalValueAtStake(groupAttention(items)), 8_500_000);
});

test("groups stay ordered by urgency then value", () => {
  const late = { firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(30 * MIN) };
  const groups = groupAttention(buildAttentionList([
    opp({ id: "tidy", nextAction: "", nextActionDate: null, valueCents: 99_000_000 }),
    opp({ id: "small-late", ...late, valueCents: 1_000_000 }),
    opp({ id: "big-late", ...late, valueCents: 8_000_000 }),
  ], OPTS));
  assert.deepEqual(groups.map((g) => g.opportunityId), ["big-late", "small-late", "tidy"]);
});

test("grouping preserves every opportunity", () => {
  const rows = [opp({ id: "a", nextAction: "", nextActionDate: null }),
                opp({ id: "b", approvalState: "waiting" }),
                opp({ id: "c", nextActionDate: ago(DAY) })];
  const groups = groupAttention(buildAttentionList(rows, OPTS));
  assert.deepEqual(new Set(groups.map((g) => g.opportunityId)), new Set(["a", "b", "c"]));
});

// ── Missing information (Mario's checklist item 4) ───────────────────────────

test("a blank essential field blocks a deal that is ready to quote", () => {
  const k = kinds(opp({ stage: "proposal_needed", blockingGaps: ["Email address"] }));
  assert.ok(k.includes("missing_info"));
});

test("but a brand new lead is not nagged about it", () => {
  // Nobody has discussed a venue or an email yet; flagging here is just noise.
  assert.ok(!kinds(opp({ stage: "new_lead", blockingGaps: ["Email address"] })).includes("missing_info"));
  assert.ok(!kinds(opp({ stage: "contacted", blockingGaps: ["Email address"] })).includes("missing_info"));
});

test("the headline says what is missing and why it matters", () => {
  const [item] = attentionFor(
    opp({ stage: "proposal_sent", blockingGaps: ["Email address"], nextAction: "x", nextActionDate: new Date(NOW.getTime() + DAY) }),
    OPTS).filter((i) => i.kind === "missing_info");
  assert.equal(item.headline, "Cannot send: no email address on file");
});

test("it outranks an overdue action but not an unanswered lead", () => {
  const list = buildAttentionList([
    opp({ id: "overdue", stage: "proposal_needed", nextActionDate: ago(3 * DAY) }),
    opp({ id: "blocked", stage: "proposal_needed", blockingGaps: ["Email address"] }),
    opp({ id: "unanswered", firstResponseAt: null, lastOutboundAt: null, leadReceivedAt: ago(2 * HOUR) }),
  ], OPTS);
  assert.equal(list[0].opportunityId, "unanswered");
  assert.equal(list[1].opportunityId, "blocked");
});

test("a closed deal with gaps is left alone", () => {
  assert.deepEqual(kinds(opp({ stage: "won", blockingGaps: ["Email address"] })), []);
  assert.deepEqual(kinds(opp({ stage: "lost", blockingGaps: ["Email address"] })), []);
});

// The blind spot this rule exists to close.
//
// Proposal goes out and the sequence arms. The client replies, which pauses
// it (correct: the brief requires a human conversation to stop the robot).
// The planner replies, which clears "client waiting". From that moment the
// deal matched no rule at all: followup_overdue needs an ACTIVE sequence,
// proposal_silent needs no inbound to have ever arrived, and no_next_action
// clears the moment anyone types anything. A live deal went quiet and nobody
// was told.
test("a paused follow-up that has gone quiet is surfaced", () => {
  const stalled = opp({
    stage: "proposal_sent",
    proposalSentAt: ago(20 * DAY),
    followupState: "paused",
    followupDueAt: null,
    lastInboundAt: ago(14 * DAY),
    lastOutboundAt: ago(13 * DAY),   // we replied last, so client_waiting is clear
    nextAction: "Chase the contract", // and a next action exists, so that rule is clear
    nextActionDate: new Date(NOW.getTime() + DAY),
  });
  assert.ok(kinds(stalled).includes("followup_stalled"), `got ${JSON.stringify(kinds(stalled))}`);
});

test("a paused follow-up that is still warm is left alone", () => {
  const warm = opp({
    stage: "proposal_sent",
    proposalSentAt: ago(20 * DAY),
    followupState: "paused",
    lastInboundAt: ago(2 * DAY),
    lastOutboundAt: ago(1 * DAY),
    nextAction: "Chase the contract",
    nextActionDate: new Date(NOW.getTime() + DAY),
  });
  assert.ok(!kinds(warm).includes("followup_stalled"), `got ${JSON.stringify(kinds(warm))}`);
});

test("an active or stopped sequence is not reported as stalled", () => {
  for (const state of ["active", "stopped", "inactive"] as const) {
    const o = opp({
      stage: "proposal_sent", proposalSentAt: ago(20 * DAY), followupState: state,
      lastInboundAt: ago(14 * DAY), lastOutboundAt: ago(13 * DAY),
      nextAction: "x", nextActionDate: new Date(NOW.getTime() + DAY),
    });
    assert.ok(!kinds(o).includes("followup_stalled"), `${state} -> ${JSON.stringify(kinds(o))}`);
  }
});

test("a won or lost deal is never reported as stalled", () => {
  const won = opp({
    stage: "won", followupState: "paused",
    lastInboundAt: ago(60 * DAY), lastOutboundAt: ago(59 * DAY),
  });
  assert.deepEqual(kinds(won), []);
});
