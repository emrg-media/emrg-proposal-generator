import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAddress, splitName, cleanBody, isAutomated, normalizeSubject, findForwardedSender,
} from "./emailParse";

test("addresses parse in the shapes mail clients actually send", () => {
  assert.deepEqual(parseAddress("Jane Doe <jane@acme.com>"), { email: "jane@acme.com", name: "Jane Doe" });
  assert.deepEqual(parseAddress('"Doe, Jane" <jane@acme.com>'), { email: "jane@acme.com", name: "Doe, Jane" });
  assert.deepEqual(parseAddress("jane@acme.com"), { email: "jane@acme.com", name: "" });
  assert.deepEqual(parseAddress("  <JANE@ACME.COM> "), { email: "jane@acme.com", name: "" });
  assert.deepEqual(parseAddress(""), { email: "", name: "" });
});

test("names split, including the surname-first form", () => {
  assert.deepEqual(splitName("Jane Doe"), { firstName: "Jane", lastName: "Doe" });
  assert.deepEqual(splitName("Doe, Jane"), { firstName: "Jane", lastName: "Doe" });
  assert.deepEqual(splitName("Jane van der Berg"), { firstName: "Jane", lastName: "van der Berg" });
  assert.deepEqual(splitName("Cher"), { firstName: "", lastName: "Cher" });
  assert.deepEqual(splitName(""), { firstName: "", lastName: "" });
});

test("a quoted reply chain is cut off", () => {
  const body = [
    "We'd like to book something for 200 people in December.",
    "",
    "On Mon, 3 Mar 2027 at 09:14, Victoria <v@emrg.com> wrote:",
    "> Happy to help, what dates are you looking at?",
    "> Victoria",
  ].join("\n");
  const clean = cleanBody(body);
  assert.ok(clean.includes("200 people"));
  assert.ok(!clean.includes("Happy to help"), "history must not reach the extractor");
});

test("an Outlook style original-message divider is cut off too", () => {
  const clean = cleanBody("New enquiry below.\n\n-----Original Message-----\nFrom: someone\nold stuff");
  assert.equal(clean, "New enquiry below.");
});

test("a signature is KEPT, because it carries the company and job title", () => {
  // Stripping it lost "Northwind Aerospace" and "Chief of Staff" on a real
  // enquiry, which were the only place either appeared.
  const clean = cleanBody("Can you quote a gala for 300?\n\nThanks,\nJane Doe\nVP Events, Acme Corp");
  assert.ok(clean.includes("gala for 300"));
  assert.ok(clean.includes("VP Events, Acme Corp"), "the signature is the only source of these");
});

test("but it can be stripped when asked", () => {
  const clean = cleanBody("Can you quote a gala for 300?\n\nThanks,\nJane Doe\nVP Events",
    { stripSignature: true });
  assert.ok(!clean.includes("VP Events"));
});

test("quoted history is always removed, signature setting or not", () => {
  const body = "New request for 200.\n\nOn Mon, someone wrote:\n> ignore this old thread";
  for (const opts of [{}, { stripSignature: true }]) {
    assert.ok(!cleanBody(body, opts).includes("old thread"));
  }
});

test("an email that OPENS with a pleasantry keeps its content", () => {
  // Trimming from the front would leave nothing to extract from.
  const clean = cleanBody("Thanks,\n\nWe need a venue for 120 guests on June 2nd.");
  assert.ok(clean.includes("120 guests"), clean);
});

test("a plain email is left alone", () => {
  const body = "Hi, we're planning an awards dinner for 400 in May. What would that cost?";
  assert.equal(cleanBody(body), body);
});

test("out of office and bounces are recognised as automated", () => {
  const base = { fromEmail: "jane@acme.com", subject: "Enquiry", body: "hello" };
  assert.equal(isAutomated(base), false);
  assert.equal(isAutomated({ ...base, subject: "Out of Office: back Monday" }), true);
  assert.equal(isAutomated({ ...base, subject: "Automatic reply: away" }), true);
  assert.equal(isAutomated({ ...base, subject: "Undeliverable: your message" }), true);
  assert.equal(isAutomated({ ...base, fromEmail: "MAILER-DAEMON@acme.com" }), true);
  assert.equal(isAutomated({ ...base, fromEmail: "no-reply@acme.com" }), true);
  assert.equal(isAutomated({ ...base, fromEmail: "donotreply@acme.com" }), true);
});

test("marketing mail is recognised by its headers and its footer", () => {
  const base = { fromEmail: "news@brand.com", subject: "Our spring range", body: "buy things" };
  assert.equal(isAutomated({ ...base, headers: { "List-Unsubscribe": "<mailto:x>" } }), true);
  assert.equal(isAutomated({ ...base, headers: { "Auto-Submitted": "auto-replied" } }), true);
  assert.equal(isAutomated({ ...base, headers: { Precedence: "bulk" } }), true);
  assert.equal(isAutomated({ ...base, body: "Click here to unsubscribe" }), true);
});

test("a genuine enquiry from a normal person is not flagged", () => {
  assert.equal(isAutomated({
    fromEmail: "priya.raman@northwind.com",
    subject: "Re: Awards gala",
    body: "Following up on our call, we're looking at 450 guests.",
    headers: { "Auto-Submitted": "no" },
  }), false);
});

test("subjects normalise so a thread can be recognised", () => {
  assert.equal(normalizeSubject("Re: Fwd: RE: Holiday party"), "Holiday party");
  assert.equal(normalizeSubject("Holiday party"), "Holiday party");
  assert.equal(normalizeSubject(""), "");
});

test("a forwarded enquiry is attributed to the client, not the colleague", () => {
  const body = [
    "Mario, see below.",
    "",
    "---------- Forwarded message ---------",
    "From: Priya Raman <priya@northwind.com>",
    "Date: Mon, 3 Mar 2027",
    "Subject: Awards gala",
    "",
    "We'd like a quote for 450 guests.",
  ].join("\n");
  assert.deepEqual(findForwardedSender(body), { email: "priya@northwind.com", name: "Priya Raman" });
});

test("a normal email has no forwarded sender", () => {
  assert.equal(findForwardedSender("Just a normal note.\nFrom: me"), null);
});

// findForwardedSender decides who a lead is attributed to, and the body it
// reads is attacker-controlled: anyone can email the address that gets
// forwarded into the system.
test("a From: line above the marker cannot claim the lead", () => {
  const body = "From: ceo@big.example\n\n"
    + "---------- Forwarded message ----------\n"
    + "From: real@client.example\n";
  assert.equal(findForwardedSender(body)?.email, "real@client.example");
});

test("an inner From with no address is refused, not turned into garbage", () => {
  const body = "FYI\n---------- Forwarded message ----------\nFrom: Accounts Payable\n";
  // Previously yielded the truthy string "accounts payable", which then
  // replaced a perfectly good envelope address on the record.
  assert.equal(findForwardedSender(body), null);
});

test("a marker with no From after it yields nothing", () => {
  assert.equal(findForwardedSender("---------- Forwarded message ----------\nhello"), null);
});

test("both forwarding markers are recognised", () => {
  assert.equal(
    findForwardedSender("Begin forwarded message:\nFrom: a@b.example\n")?.email,
    "a@b.example",
  );
  assert.equal(
    findForwardedSender("--- Forwarded message ---\nFrom: c@d.example\n")?.email,
    "c@d.example",
  );
});
