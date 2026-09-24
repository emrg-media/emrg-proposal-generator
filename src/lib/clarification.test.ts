import { test } from "node:test";
import assert from "node:assert/strict";
import { composeClarification, hasSomethingToAsk, type ClarificationInput } from "./clarification";

function opp(over: Partial<ClarificationInput> = {}): ClarificationInput {
  return {
    company: "Acme Corp", firstName: "Dana", lastName: "Whitfield", title: "Head of Events",
    email: "dana@acme.test", cellPhone: "212-555-0100",
    eventDate: "June 2, 2027", guestCount: "300", venue: "Brooklyn Navy Yard",
    eventTypes: ["Product Launch"], requestedServices: ["Entertainment"],
    feeRaw: "$30,000", budgetLowCents: 12_000_000, budgetHighCents: 18_000_000,
    eventName: "Product Launch", ownerName: "Victoria",
    ...over,
  };
}

test("a complete record has nothing to ask", () => {
  assert.equal(hasSomethingToAsk(opp()), false);
  assert.equal(composeClarification(opp()).asking.length, 0);
});

test("it greets the contact and names the event", () => {
  const d = composeClarification(opp({ guestCount: "" }));
  assert.ok(d.body.startsWith("Hi Dana,"), d.body.slice(0, 20));
  assert.ok(d.body.includes("Product Launch"));
  assert.ok(d.subject.includes("Product Launch"));
});

test("it is signed by the owner, not the system", () => {
  assert.ok(composeClarification(opp({ guestCount: "", ownerName: "Amanda" })).body.includes("Amanda"));
});

test("one gap is asked inline, several become a list", () => {
  const one = composeClarification(opp({ guestCount: "" }));
  assert.ok(!one.body.includes("- "), "a single question does not need a bullet");
  assert.equal(one.subject, "Quick question about Product Launch");

  const many = composeClarification(opp({ guestCount: "", venue: "", eventDate: "" }));
  assert.ok(many.body.includes("- "), "several questions are listed");
  assert.equal(many.subject, "Quick questions about Product Launch");
});

test("it never chases a client for optional details", () => {
  // Asking a client for their job title makes the team look like it is filling
  // in a form rather than planning an event.
  const d = composeClarification(opp({ cellPhone: "", title: "" }));
  assert.equal(d.asking.length, 0);
  assert.equal(hasSomethingToAsk(opp({ cellPhone: "", title: "" })), false);
});

test("it never asks someone for their own email address", () => {
  // There is nowhere to send that email, so the question is meaningless.
  const d = composeClarification(opp({ email: "", guestCount: "" }));
  assert.ok(!d.asking.some((m) => m.key === "email"));
  assert.ok(!/email address/i.test(d.body), d.body);
});

test("with no address on file the draft says it cannot be sent", () => {
  const d = composeClarification(opp({ email: "", guestCount: "" }));
  assert.equal(d.canSend, false);
  assert.match(d.blockedReason, /no email address/i);
  // The questions still exist, so they can be asked on a call.
  assert.ok(d.asking.length > 0);
});

test("a complete contact can be sent to", () => {
  assert.equal(composeClarification(opp({ guestCount: "" })).canSend, true);
});

test("the percentage fee gap is explained, not just listed", () => {
  const d = composeClarification(opp({ feeRaw: "20%", budgetLowCents: null, budgetHighCents: null }));
  assert.match(d.body, /percentage/i, "the client is told why the budget is needed");
});

test("it falls back gracefully with almost nothing on file", () => {
  const d = composeClarification({
    company: "", firstName: "", lastName: "", title: "", email: "x@y.test", cellPhone: "",
    eventDate: "", guestCount: "", venue: "", eventTypes: [], requestedServices: [],
    feeRaw: "", budgetLowCents: null, budgetHighCents: null,
    eventName: "", ownerName: "",
  });
  assert.ok(d.body.startsWith("Hi there,"), "no name still reads naturally");
  assert.ok(d.subject.includes("your event"), d.subject);
  assert.ok(d.body.includes("EMRG Media"), "always signed off");
});

test("the event type is used when there is no event name", () => {
  const d = composeClarification(opp({ eventName: "", guestCount: "", eventTypes: ["Charity Gala"] }));
  assert.ok(d.subject.includes("charity gala"), d.subject);
});

test("many questions get the reassurance that rough answers are fine", () => {
  const d = composeClarification(opp({ guestCount: "", venue: "", eventDate: "", requestedServices: [] }));
  assert.match(d.body, /rough numbers/i);
});
