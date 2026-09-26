import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFee, feeLabel, parseMoneyToCents, budgetText, toCents, fromCents } from "./fee";

test("plain dollar fee is exact, not an estimate", () => {
  const r = computeFee("$12,000", "");
  assert.equal(r.value, 12000);
  assert.equal(r.estimated, false);
  assert.equal(r.needsBudget, false);
});

test("k suffix expands", () => {
  assert.equal(computeFee("$12k", "").value, 12000);
});

test("dollar range averages and flags an estimate", () => {
  const r = computeFee("$8,000-$12,000", "");
  assert.equal(r.value, 10000);
  assert.equal(r.estimated, true);
});

test("percentage applies to a single budget", () => {
  const r = computeFee("20%", "$50,000");
  assert.equal(r.value, 10000);
  assert.equal(r.estimated, true);
  assert.match(r.basis, /20% of the \$50,000 budget/);
});

test("percentage across a budget range averages the bounds", () => {
  // 20% of 50k = 10k, 20% of 100k = 20k -> 15k
  const r = computeFee("20%", "$50,000 to $100,000");
  assert.equal(r.value, 15000);
  assert.equal(r.estimated, true);
});

test("percentage range averages the percentages", () => {
  // (18+22)/2 = 20% of 50k = 10k
  const r = computeFee("18-22%", "$50,000");
  assert.equal(r.value, 10000);
});

test("percentage with no budget cannot be resolved", () => {
  const r = computeFee("20%", "");
  assert.equal(r.value, null);
  assert.equal(r.needsBudget, true);
  assert.equal(feeLabel(r, "20%"), "Fee TBD");
});

test("empty and unparseable fees do not count toward totals", () => {
  assert.equal(computeFee("", "").value, null);
  assert.equal(computeFee("TBD", "").value, null);
  assert.equal(computeFee("ask Erica", "").value, null);
});

test("a 100% fee is still a valid percentage", () => {
  assert.equal(computeFee("100%", "$10,000").value, 10000);
});

test("feeLabel marks estimates with a tilde", () => {
  assert.equal(feeLabel(computeFee("$12,000", ""), "$12,000"), "$12,000");
  assert.equal(feeLabel(computeFee("$8k-12k", ""), "$8k-12k"), "≈ $10,000");
});

test("cents round-trip without drift", () => {
  assert.equal(toCents(12000), 1200000);
  assert.equal(fromCents(1200000), 12000);
  assert.equal(toCents(null), null);
  assert.equal(fromCents(null), null);
});

test("parseMoneyToCents reads the first amount", () => {
  assert.equal(parseMoneyToCents("$50,000"), 5000000);
  assert.equal(parseMoneyToCents("50k"), 5000000);
  assert.equal(parseMoneyToCents(""), null);
});

test("budgetText renders stored bounds back for percentage maths", () => {
  assert.equal(budgetText(5000000, 10000000), "$50,000 to $100,000");
  assert.equal(budgetText(5000000, null), "$50,000");
  assert.equal(budgetText(null, null), "");
});

test("round-trip: stored budget resolves a percentage fee identically", () => {
  const text = budgetText(parseMoneyToCents("$50,000"), parseMoneyToCents("$100,000"));
  assert.equal(computeFee("20%", text).value, 15000);
});

// ── Regression: the percentage fee that became $20 ───────────────────────────
//
// The generator's currency filter stripped "%" from the service fee field, so a
// 20% fee on an $80,000 event was stored as the literal number 20 and resolved
// to $20 — four orders of magnitude out, flowing straight into pipeline value,
// win/loss totals and the executive dashboard. These lock in the difference.

test("a percentage fee resolves against the budget, not as dollars", () => {
  const withPercent = computeFee("20%", "$70,000 to $90,000");
  assert.equal(withPercent.value, 16000, "20% of the $80,000 midpoint");
  assert.equal(withPercent.estimated, true);
});

test("the same fee with the % stripped is a completely different number", () => {
  // This is what the bug produced, and why the % must survive input filtering.
  assert.equal(computeFee("20", "$70,000 to $90,000").value, 20);
});

test("a percentage range still resolves against the budget", () => {
  assert.equal(computeFee("18-22%", "$70,000 to $90,000").value, 16000);
});

// A percentage fee must read only the numbers attached to the % sign. Taking
// every number in the string read "15% of $50,000" as 15 and 50 averaged to
// 32.5%, booking $65,000 against a $30,000 fee on a $200,000 event, and that
// figure is the sole input to the executive dashboard's pipeline value.
test("a percentage fee ignores dollar amounts written beside it", () => {
  assert.equal(computeFee("15% of $50,000", "$200,000").value, 30000);
  assert.equal(computeFee("20% (capped at $30,000)", "$200,000").value, 40000);
  assert.equal(computeFee("management fee 10% of the $80,000 budget", "$200,000").value, 20000);
});

test("a percentage range still averages its two bounds", () => {
  assert.equal(computeFee("18-22%", "$200,000").value, 40000);
  assert.equal(computeFee("20% to 25%", "$200,000").value, 45000);
  assert.equal(computeFee("18 – 22 %", "$200,000").value, 40000);
});

test("a single percentage is unchanged", () => {
  assert.equal(computeFee("20%", "$200,000").value, 40000);
  assert.equal(computeFee("7.5%", "$200,000").value, 15000);
});
