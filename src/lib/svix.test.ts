import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyWebhook, signWebhook } from "./svix";

const SECRET = "whsec_" + Buffer.from("a-test-signing-key-32-bytes-long").toString("base64");
const BODY = JSON.stringify({ type: "email.received", data: { email_id: "abc" } });
const ID = "msg_2abc";
const NOW = new Date("2027-03-03T09:14:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

const headers = (over: Partial<{ id: string; timestamp: string; signature: string }> = {}) => ({
  id: ID, timestamp: TS, signature: signWebhook(BODY, ID, TS, SECRET), ...over,
});

test("a correctly signed request is accepted", () => {
  assert.deepEqual(verifyWebhook(BODY, headers(), SECRET, NOW), { ok: true });
});

test("a tampered body is rejected", () => {
  const forged = JSON.stringify({ type: "email.received", data: { email_id: "someone-elses" } });
  assert.equal(verifyWebhook(forged, headers(), SECRET, NOW).ok, false);
});

test("even a single changed character is rejected", () => {
  assert.equal(verifyWebhook(BODY + " ", headers(), SECRET, NOW).ok, false);
});

test("a signature from a different secret is rejected", () => {
  const other = "whsec_" + Buffer.from("a-completely-different-key-here!").toString("base64");
  const h = { id: ID, timestamp: TS, signature: signWebhook(BODY, ID, TS, other) };
  assert.equal(verifyWebhook(BODY, h, SECRET, NOW).ok, false);
});

test("reusing a signature with a different message id is rejected", () => {
  assert.equal(verifyWebhook(BODY, headers({ id: "msg_different" }), SECRET, NOW).ok, false);
});

test("an old request is refused, so a captured one cannot be replayed", () => {
  const later = new Date(NOW.getTime() + 10 * 60 * 1000);
  const r = verifyWebhook(BODY, headers(), SECRET, later);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /tolerance/i);
});

test("a request from the future is refused too", () => {
  const earlier = new Date(NOW.getTime() - 10 * 60 * 1000);
  assert.equal(verifyWebhook(BODY, headers(), SECRET, earlier).ok, false);
});

test("a request just inside the window is still fine", () => {
  const later = new Date(NOW.getTime() + 4 * 60 * 1000);
  assert.equal(verifyWebhook(BODY, headers(), SECRET, later).ok, true);
});

test("missing headers are refused rather than throwing", () => {
  for (const h of [
    { id: null, timestamp: TS, signature: "v1,x" },
    { id: ID, timestamp: null, signature: "v1,x" },
    { id: ID, timestamp: TS, signature: null },
  ]) {
    assert.equal(verifyWebhook(BODY, h, SECRET, NOW).ok, false);
  }
});

test("an unset secret fails closed", () => {
  assert.equal(verifyWebhook(BODY, headers(), "", NOW).ok, false);
});

test("a nonsense timestamp is refused", () => {
  assert.equal(verifyWebhook(BODY, headers({ timestamp: "not-a-number" }), SECRET, NOW).ok, false);
});

test("several signatures are accepted if any one matches, as during a rotation", () => {
  const good = signWebhook(BODY, ID, TS, SECRET);
  const h = { id: ID, timestamp: TS, signature: `v1,someOldSignature ${good}` };
  assert.equal(verifyWebhook(BODY, h, SECRET, NOW).ok, true);
});

test("a signature of an unknown version alone is not enough", () => {
  const h = { id: ID, timestamp: TS, signature: "v2,whateverThisIs" };
  const r = verifyWebhook(BODY, h, SECRET, NOW);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /v1/);
});

test("a signature of the wrong length does not throw", () => {
  assert.equal(verifyWebhook(BODY, headers({ signature: "v1,short" }), SECRET, NOW).ok, false);
});
