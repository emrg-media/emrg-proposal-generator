import { test } from "node:test";
import assert from "node:assert/strict";
import { mapExtractionToProposal } from "./extractionMap";

// Captured verbatim from a real POST to /api/extract on production. If the
// route's schema changes, this fixture is what should be updated, and these
// assertions are what will fail loudly instead of the button quietly doing
// nothing on camera.
const REAL_RESPONSE = {
  is_event_enquiry: true,
  confidence: "high",
  company: "Halvorsen Biosciences",
  first_name: "Dana",
  last_name: "Whitfield",
  title: "VP of Corporate Communications",
  email: "d.whitfield@halvorsenbio.com",
  cell_phone: "917-555-0148",
  address: "", city: "", state: "", zip: "", website: "",
  lead_source: "Discovery Call",
  event_name: "Halvorsen Biosciences Awards Gala",
  event_types: ["Awards Gala"],
  event_date: "March 12, 2027",
  guest_count: "380",
  venue: "Cipriani 42nd Street",
  budget_low: "$180,000",
  budget_high: "$220,000",
  service_fee: "20%",
  requested_services: ["AV", "Entertainment", "Staffing", "Branding"],
  notes: "Annual awards gala for research teams. Venue already booked.",
};

test("a real extraction fills the proposal, which is the bug this prevents", () => {
  const m = mapExtractionToProposal(REAL_RESPONSE);
  assert.equal(m.client.client_name, "Halvorsen Biosciences");
  assert.equal(m.client.signer_name, "Dana Whitfield");
  assert.equal(m.client.signer_title, "VP of Corporate Communications");
  assert.equal(m.client.client_email, "d.whitfield@halvorsenbio.com");
  assert.equal(m.client.venue, "Cipriani 42nd Street");
  assert.equal(m.client.budget_low, "$180,000");
  assert.equal(m.client.budget_high, "$220,000");
  assert.equal(m.client.service_fee, "20%");
  assert.equal(m.leadSource, "Discovery Call");
});

test("the flat event fields become one event row", () => {
  const m = mapExtractionToProposal(REAL_RESPONSE);
  assert.deepEqual(m.event, {
    date: "March 12, 2027",
    eventTypes: ["Awards Gala"],
    guestCount: "380",
  });
});

test("every field the builder shows is populated, none left blank", () => {
  const m = mapExtractionToProposal(REAL_RESPONSE);
  const blank = Object.entries(m.client).filter(([, v]) => !v).map(([k]) => k);
  assert.deepEqual(blank, [], `blank after mapping: ${blank.join(", ")}`);
  assert.ok(m.event, "no event row produced");
});

test("a first name with no surname still yields a signer", () => {
  const m = mapExtractionToProposal({ first_name: "Dana", last_name: "" });
  assert.equal(m.client.signer_name, "Dana");
});

test("absent fields are omitted, so an import never blanks typed input", () => {
  const m = mapExtractionToProposal({ company: "Acme" });
  assert.deepEqual(Object.keys(m.client), ["client_name"]);
  assert.equal(m.event, undefined);
  assert.equal(m.leadSource, undefined);
});

test("an event with only a guest count still produces a row", () => {
  const m = mapExtractionToProposal({ guest_count: "120" });
  assert.deepEqual(m.event, { date: "", eventTypes: [], guestCount: "120" });
});

test("junk in does not throw", () => {
  for (const junk of [null, undefined, "nope", 42, [], { event_types: "Gala" }]) {
    assert.doesNotThrow(() => mapExtractionToProposal(junk));
  }
  // A string where a list was promised is ignored rather than crashing.
  assert.equal(mapExtractionToProposal({ event_types: "Gala" }).event, undefined);
});

test("whitespace is trimmed rather than filling fields with spaces", () => {
  const m = mapExtractionToProposal({ company: "  Acme  ", first_name: " Dana ", last_name: " Whitfield " });
  assert.equal(m.client.client_name, "Acme");
  assert.equal(m.client.signer_name, "Dana Whitfield");
});
