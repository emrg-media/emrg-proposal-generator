import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shortName, addressLine, eventDescriptor, timingClause, halfOfFee, agreementDefaults,
} from "./agreement";

// The reference document is EMRG's own Carbon Direct Capital agreement.

test("the short name matches the reference document", () => {
  assert.equal(shortName("Carbon Direct Capital"), "Carbon");
});

test("the short name handles the shapes a company name actually takes", () => {
  assert.equal(shortName("Brightwater Partners"), "Brightwater");
  assert.equal(shortName("The Wythe Group"), "Wythe");
  assert.equal(shortName("Acme, Inc."), "Acme");
  assert.equal(shortName("  Northwind   Aerospace "), "Northwind");
  assert.equal(shortName("Kestrel"), "Kestrel");
  assert.equal(shortName(""), "");
});

test("the address reads as one line, skipping what is missing", () => {
  assert.equal(
    addressLine({ address: "17 State Street", city: "New York", state: "NY", zip: "10004" }),
    "17 State Street New York NY 10004",
  );
  assert.equal(addressLine({ city: "New York", state: "NY" }), "New York NY");
  assert.equal(addressLine({}), "");
});

test("the event reads lowercase, mid-sentence", () => {
  assert.equal(eventDescriptor(["Investor Event"]), "investor event");
  assert.equal(eventDescriptor(["Holiday Party", "Awards Gala"]), "holiday party");
  assert.equal(eventDescriptor([]), "event");
  assert.equal(eventDescriptor(undefined), "event");
});

test("a settled date is stated, an unsettled one is not invented", () => {
  assert.equal(timingClause("March 12, 2027"), "on March 12, 2027");
  assert.equal(timingClause(""), "exact date TBD");
  assert.equal(timingClause("sometime next spring"), "exact date TBD");
});

test("a year with no day keeps the reference document's wording", () => {
  assert.equal(timingClause("Q2 2027"), "in 2027, exact date TBD");
});

test("the two payments halve the fee, as in the reference document", () => {
  // $21,500 split into $10,750 and $10,750.
  assert.equal(halfOfFee("$21,500", ""), "$10,750");
});

test("a percentage fee is resolved before it is halved", () => {
  // 18% of the $175,000-$200,000 midpoint is $33,750.
  assert.equal(halfOfFee("18%", "$175,000 to $200,000"), "$16,875");
});

test("a fee that cannot be resolved yields no figure rather than a wrong one", () => {
  assert.equal(halfOfFee("20%", ""), "");
  assert.equal(halfOfFee("", ""), "");
});

test("the reference document is reproduced end to end", () => {
  const d = agreementDefaults({
    client_name: "Carbon Direct Capital",
    signer_name: "Alicia Estella",
    signer_title: "CFO & CCO",
    address: "17 State Street", city: "New York", state: "NY", zip: "10004",
    eventTypes: ["Investor Event"],
    eventDate: "",
    service_fee: "$21,500",
    budget_low: "$175,000", budget_high: "$200,000",
  });

  assert.equal(d.short_name, "Carbon");
  assert.equal(d.client_address, "17 State Street New York NY 10004");
  assert.equal(d.event_descriptor, "investor event");
  assert.equal(d.timing, "exact date TBD");
  assert.equal(d.deposit_first, "$10,750");
  assert.equal(d.deposit_second, "$10,750");
  assert.equal(d.location, "NYC");
});

test("a chosen venue is named instead of the city", () => {
  const d = agreementDefaults({ client_name: "X Co", venue: "Cipriani 42nd Street" });
  assert.equal(d.location, "Cipriani 42nd Street");
});

test("nothing in, nothing invented", () => {
  const d = agreementDefaults({});
  assert.equal(d.short_name, "");
  assert.equal(d.deposit_first, "");
  assert.equal(d.timing, "exact date TBD");
  assert.equal(d.location, "NYC");
});
