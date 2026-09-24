import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkCompleteness, missingSummary, clarificationQuestions, type CompletenessInput,
} from "./completeness";

function opp(over: Partial<CompletenessInput> = {}): CompletenessInput {
  return {
    company: "Acme Corp", firstName: "Dana", lastName: "Whitfield", title: "Head of Events",
    email: "dana@acme.test", cellPhone: "212-555-0100",
    eventDate: "June 2, 2027", guestCount: "300", venue: "Brooklyn Navy Yard",
    eventTypes: ["Product Launch"], requestedServices: ["Entertainment", "AV"],
    feeRaw: "$30,000", budgetLowCents: 12_000_000, budgetHighCents: 18_000_000,
    ...over,
  };
}
const keys = (o: CompletenessInput) => checkCompleteness(o).missing.map((m) => m.key);

test("a complete record has nothing outstanding", () => {
  const c = checkCompleteness(opp());
  assert.deepEqual(c.missing, []);
  assert.equal(c.readyToSend, true);
  assert.equal(c.score, 1);
  assert.equal(missingSummary(c), "");
});

test("a missing email blocks sending", () => {
  const c = checkCompleteness(opp({ email: "" }));
  assert.equal(c.readyToSend, false);
  assert.ok(c.blocking.some((m) => m.key === "email"));
});

test("no company AND no contact name blocks, but either alone is fine", () => {
  assert.ok(keys(opp({ company: "", lastName: "" })).includes("company"));
  assert.ok(!keys(opp({ company: "", lastName: "Whitfield" })).includes("company"));
  assert.ok(!keys(opp({ company: "Acme Corp", lastName: "" })).includes("company"));
});

test("every field Mario listed is checked", () => {
  const bare = opp({
    eventDate: "", guestCount: "", venue: "", eventTypes: [], requestedServices: [],
    feeRaw: "", budgetLowCents: null, budgetHighCents: null, email: "", cellPhone: "",
  });
  const k = keys(bare);
  for (const field of ["eventDate", "guestCount", "venue", "requestedServices", "budget", "email", "cellPhone"]) {
    assert.ok(k.includes(field), `${field} is not being checked`);
  }
});

test("a percentage fee with no budget is flagged, because the value cannot be worked out", () => {
  const c = checkCompleteness(opp({ feeRaw: "20%", budgetLowCents: null, budgetHighCents: null }));
  const budget = c.missing.find((m) => m.key === "budget")!;
  assert.ok(budget, "should ask for the budget");
  assert.match(budget.ask, /percentage/i, "and say why it is needed");
});

test("a percentage fee WITH a budget is fine", () => {
  assert.ok(!keys(opp({ feeRaw: "20%" })).includes("budget"));
});

test("the budget is only asked for once", () => {
  const k = keys(opp({ feeRaw: "20%", budgetLowCents: null, budgetHighCents: null }));
  assert.equal(k.filter((x) => x === "budget").length, 1);
});

test("optional gaps never block sending", () => {
  const c = checkCompleteness(opp({ cellPhone: "", title: "" }));
  assert.equal(c.readyToSend, true);
  assert.equal(c.blocking.length, 0);
  assert.equal(c.optional.length, 2);
});

test("whitespace does not count as filled in", () => {
  assert.ok(keys(opp({ eventDate: "   " })).includes("eventDate"));
  assert.ok(keys(opp({ email: "  " })).includes("email"));
});

test("a venue deliberately marked TBD counts as answered", () => {
  // "TBD" is a real answer; only a blank field is an open question.
  assert.ok(!keys(opp({ venue: "TBD" })).includes("venue"));
});

test("the summary leads with what blocks sending", () => {
  const c = checkCompleteness(opp({ email: "", guestCount: "", venue: "" }));
  assert.match(missingSummary(c), /^Missing email address/);
});

test("the summary counts the softer gaps when nothing blocks", () => {
  assert.equal(missingSummary(checkCompleteness(opp({ guestCount: "", venue: "" }))),
    "2 details still needed");
});

test("score falls as more is missing, and never goes negative", () => {
  assert.equal(checkCompleteness(opp()).score, 1);
  assert.ok(checkCompleteness(opp({ guestCount: "" })).score < 1);
  const nothing = checkCompleteness({
    company: "", firstName: "", lastName: "", title: "", email: "", cellPhone: "",
    eventDate: "", guestCount: "", venue: "", eventTypes: [], requestedServices: [],
    feeRaw: "", budgetLowCents: null, budgetHighCents: null,
  });
  assert.ok(nothing.score >= 0);
  assert.equal(nothing.readyToSend, false);
});

test("clarification questions are real questions, blocking ones first", () => {
  const c = checkCompleteness(opp({ email: "", guestCount: "" }));
  const qs = clarificationQuestions(c);
  assert.match(qs[0], /email address/i, "the blocking gap is asked first");
  assert.ok(qs.every((q) => q.endsWith("?")), "each one is phrased as a question");
  // Optional gaps are never chased with the client.
  const withOptional = checkCompleteness(opp({ cellPhone: "" }));
  assert.deepEqual(clarificationQuestions(withOptional), []);
});
