import { test } from "node:test";
import assert from "node:assert/strict";
import { failsSenderChecks, stripHtml } from "./resendInbound";

// Inbound mail is the only untrusted input in the system, and Resend computes
// these checks itself rather than reading them from the message, so a sender
// cannot forge a pass.

test("a hard SPF failure is rejected", () => {
  assert.match(failsSenderChecks({ spf: "fail" }) ?? "", /SPF/);
});

test("a DMARC failure is rejected", () => {
  assert.match(failsSenderChecks({ dmarc: "fail" }) ?? "", /DMARC/);
});

test("a clean message passes", () => {
  assert.equal(failsSenderChecks({ spf: "pass", dkim: "pass", dmarc: "pass" }), null);
});

test("inconclusive results are let through, not treated as failures", () => {
  // Real enquiries come from badly configured senders; only a hard fail counts.
  assert.equal(failsSenderChecks({ spf: "gray", dmarc: "processing" }), null);
  assert.equal(failsSenderChecks({ dkim: "fail" }), null, "DKIM alone is too noisy to reject on");
  assert.equal(failsSenderChecks(null), null, "older messages have no result at all");
  assert.equal(failsSenderChecks(undefined), null);
});

test("HTML falls back to readable text when there is no plain part", () => {
  const html = "<div><p>Hi there,</p><p>We need a gala for <b>300</b> guests.</p></div>";
  const text = stripHtml(html);
  assert.ok(text.includes("Hi there,"));
  assert.ok(text.includes("300"));
  assert.ok(!text.includes("<"), text);
});

test("scripts and styles are dropped, not flattened into the text", () => {
  const text = stripHtml("<style>.x{color:red}</style><script>alert(1)</script><p>Real content</p>");
  assert.equal(text, "Real content");
});

test("entities are decoded so the extractor sees real characters", () => {
  assert.equal(stripHtml("<p>Tom &amp; Jerry&#39;s &quot;party&quot;</p>"), `Tom & Jerry's "party"`);
});

test("line breaks survive so paragraphs stay separate", () => {
  assert.match(stripHtml("<p>One</p><p>Two</p>"), /One\nTwo/);
});
