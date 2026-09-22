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
