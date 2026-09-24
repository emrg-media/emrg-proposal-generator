import { test } from "node:test";
import assert from "node:assert/strict";
import {
  routeOpportunity, parseRoutingSettings, describeRule, DEFAULT_ROUTING,
  type RoutingContext, type RoutingCandidate, type RoutingRule,
} from "./routing";

const lead = (over: Partial<RoutingCandidate> = {}): RoutingCandidate => ({
  company: "Acme Corp", email: "dana@acme.test",
  eventTypes: ["Product Launch"], leadSource: "Website Form",
  valueCents: 3_000_000, ...over,
});

const ctx = (over: Partial<RoutingContext> = {}): RoutingContext => ({
  settings: { ...DEFAULT_ROUTING },
  relationshipOwnerId: null,
  workload: [
    { userId: "victoria", openCount: 5 },
    { userId: "amanda", openCount: 2 },
    { userId: "maryjane", openCount: 9 },
  ],
  actorId: null,
  ...over,
});

const rule = (over: Partial<RoutingRule> = {}): RoutingRule => ({
  id: "r1", kind: "always", userId: "erica", enabled: true, ...over,
});

test("an existing client stays with the planner who owns the relationship", () => {
  const d = routeOpportunity(lead(), ctx({ relationshipOwnerId: "victoria" }));
  assert.equal(d.userId, "victoria");
  assert.match(d.reason, /existing client/i);
});

test("and the planner who typed it up is kept on as a collaborator", () => {
  // Amanda took this one, but Victoria owns the account. Nobody gets dropped.
  const d = routeOpportunity(lead(), ctx({ relationshipOwnerId: "victoria", actorId: "amanda" }));
  assert.equal(d.userId, "victoria");
  assert.deepEqual(d.collaboratorIds, ["amanda"]);
});

test("no pointless collaborator when the owner is already the one doing it", () => {
  const d = routeOpportunity(lead(), ctx({ relationshipOwnerId: "victoria", actorId: "victoria" }));
  assert.deepEqual(d.collaboratorIds, []);
});

test("relationship routing can be switched off", () => {
  const d = routeOpportunity(lead(), ctx({
    relationshipOwnerId: "victoria", actorId: "amanda",
    settings: { ...DEFAULT_ROUTING, relationshipWins: false },
  }));
  assert.equal(d.userId, "amanda", "falls through to whoever is doing it");
});

test("event type rules route to the specialist", () => {
  const d = routeOpportunity(lead({ eventTypes: ["Bar Mitzvah"] }), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [rule({ kind: "event_type", match: "Bar Mitzvah", userId: "erica" })] },
  }));
  assert.equal(d.userId, "erica");
});

test("event type matching ignores capitalisation", () => {
  const d = routeOpportunity(lead({ eventTypes: ["bar mitzvah"] }), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [rule({ kind: "event_type", match: "Bar Mitzvah", userId: "erica" })] },
  }));
  assert.equal(d.userId, "erica");
});

test("lead source rules work", () => {
  const d = routeOpportunity(lead({ leadSource: "Referral" }), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [rule({ kind: "lead_source", match: "Referral", userId: "erica" })] },
  }));
  assert.equal(d.userId, "erica");
});

test("value rules fire at the threshold, not above it", () => {
  const big = { ...DEFAULT_ROUTING, rules: [rule({ kind: "value_over", minValueCents: 5_000_000, userId: "erica" })] };
  assert.equal(routeOpportunity(lead({ valueCents: 5_000_000 }), ctx({ settings: big })).userId, "erica");
  assert.notEqual(routeOpportunity(lead({ valueCents: 4_999_999 }), ctx({ settings: big })).userId, "erica");
});

test("a deal with no value never matches a value rule", () => {
  const d = routeOpportunity(lead({ valueCents: null }), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [rule({ kind: "value_over", minValueCents: 1, userId: "erica" })] },
  }));
  assert.notEqual(d.userId, "erica");
});

test("rules are evaluated in order, so a specific one can sit above a catch-all", () => {
  const d = routeOpportunity(lead({ eventTypes: ["Bar Mitzvah"] }), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [
      rule({ id: "a", kind: "event_type", match: "Bar Mitzvah", userId: "erica" }),
      rule({ id: "b", kind: "always", userId: "amanda" }),
    ] },
  }));
  assert.equal(d.userId, "erica");
});

test("a disabled rule is skipped", () => {
  const d = routeOpportunity(lead(), ctx({
    settings: { ...DEFAULT_ROUTING, rules: [
      rule({ id: "a", kind: "always", userId: "erica", enabled: false }),
      rule({ id: "b", kind: "always", userId: "amanda" }),
    ] },
  }));
  assert.equal(d.userId, "amanda");
});

test("the person doing the work owns it when no rule applies", () => {
  assert.equal(routeOpportunity(lead(), ctx({ actorId: "amanda" })).userId, "amanda");
});

test("with nobody driving, the lightest workload takes it", () => {
  const d = routeOpportunity(lead(), ctx());
  assert.equal(d.userId, "amanda", "amanda has 2 open, the fewest");
  assert.match(d.reason, /workload/i);
});

test("a named default owner beats workload balancing", () => {
  const d = routeOpportunity(lead(), ctx({
    settings: { ...DEFAULT_ROUTING, fallbackUserId: "maryjane" },
  }));
  assert.equal(d.userId, "maryjane");
});

test("equal workloads break deterministically, not on row order", () => {
  const even = [{ userId: "zoe", openCount: 3 }, { userId: "adam", openCount: 3 }];
  const a = routeOpportunity(lead(), ctx({ workload: even }));
  const b = routeOpportunity(lead(), ctx({ workload: [...even].reverse() }));
  assert.equal(a.userId, b.userId);
  assert.equal(a.userId, "adam");
});

test("with no planners at all it declines rather than inventing an owner", () => {
  const d = routeOpportunity(lead(), ctx({ workload: [] }));
  assert.equal(d.userId, null);
});

test("every decision explains itself for the timeline", () => {
  const cases = [
    ctx({ relationshipOwnerId: "victoria" }),
    ctx({ actorId: "amanda" }),
    ctx(),
    ctx({ settings: { ...DEFAULT_ROUTING, rules: [rule()] } }),
  ];
  for (const c of cases) {
    const d = routeOpportunity(lead(), c);
    assert.ok(d.reason.length > 5, "a decision without a reason is not auditable");
  }
});

test("rule descriptions read like English", () => {
  assert.equal(describeRule(rule({ kind: "event_type", match: "Wedding" })), "Rule: Wedding events");
  assert.equal(describeRule(rule({ kind: "lead_source", match: "Referral" })), "Rule: leads from Referral");
  assert.equal(describeRule(rule({ kind: "value_over", minValueCents: 5_000_000 })), "Rule: worth over $50,000");
});

test("stored settings are guarded against junk", () => {
  assert.deepEqual(parseRoutingSettings(null), DEFAULT_ROUTING);
  assert.deepEqual(parseRoutingSettings("nonsense"), DEFAULT_ROUTING);
  assert.equal(parseRoutingSettings({ rules: "not an array" }).rules.length, 0);
  assert.equal(parseRoutingSettings({ fallbackUserId: "" }).fallbackUserId, null);
  // Half-written rules are dropped rather than crashing the router.
  assert.equal(parseRoutingSettings({ rules: [{ id: "a" }, { id: "b", userId: "u" }] }).rules.length, 1);
});
