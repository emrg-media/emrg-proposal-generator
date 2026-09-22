import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

// session.ts reads AUTH_SECRET lazily, at sign/verify time rather than on
// import, so setting it here covers every test below.
process.env.AUTH_SECRET = "test-secret-for-unit-tests-only";

import { signSession, verifySession } from "./session";
import { hashPin, verifyPinHash, isValidPinFormat, generatePin } from "./pin";

test("a freshly signed session verifies and carries the uid", async () => {
  const uid = "11111111-2222-3333-4444-555555555555";
  const payload = await verifySession(await signSession(uid));
  assert.ok(payload);
  assert.equal(payload.uid, uid);
  assert.ok(payload.exp > payload.iat);
});

test("a tampered payload is rejected", async () => {
  const token = await signSession("user-a");
  const [body, sig] = token.split(".");
  const forged = Buffer.from(JSON.stringify({
    uid: "user-b", iat: 0, exp: Math.floor(Date.now() / 1000) + 999,
  })).toString("base64url");
  assert.equal(await verifySession(`${forged}.${sig}`), null);
  // and the original still works, proving the test itself is sound
  assert.ok(await verifySession(`${body}.${sig}`));
});

test("a token signed with a different secret is rejected", async () => {
  const token = await signSession("user-a");
  process.env.AUTH_SECRET = "a-completely-different-secret";
  assert.equal(await verifySession(token), null);
  process.env.AUTH_SECRET = "test-secret-for-unit-tests-only";
});

test("malformed tokens are rejected rather than throwing", async () => {
  for (const bad of ["", "nodot", ".", "a.b", "....", "!!!.???"]) {
    assert.equal(await verifySession(bad), null, `should reject: ${JSON.stringify(bad)}`);
  }
  assert.equal(await verifySession(undefined), null);
});

test("an expired session is rejected", async () => {
  const expired = Buffer.from(JSON.stringify({ uid: "u", iat: 0, exp: 1 })).toString("base64url");
  // Sign that exact body so the signature is genuine and only expiry can fail it.
  const sig = createHmac("sha256", process.env.AUTH_SECRET!).update(expired).digest("base64url");
  assert.equal(await verifySession(`${expired}.${sig}`), null);
});

test("PIN hashes verify, and wrong PINs do not", async () => {
  const hash = await hashPin("123456");
  assert.equal(await verifyPinHash("123456", hash), true);
  assert.equal(await verifyPinHash("123457", hash), false);
  assert.equal(await verifyPinHash("", hash), false);
});

test("the same PIN salts to a different hash each time", async () => {
  assert.notEqual(await hashPin("123456"), await hashPin("123456"));
});

test("a malformed stored hash fails closed", async () => {
  for (const bad of ["", "nosalt", "a:", ":b"]) {
    assert.equal(await verifyPinHash("123456", bad), false);
  }
});

test("only 6-digit PINs are accepted", () => {
  assert.equal(isValidPinFormat("123456"), true);
  assert.equal(isValidPinFormat("000000"), true);
  for (const bad of ["12345", "1234567", "12345a", "", " 123456"]) {
    assert.equal(isValidPinFormat(bad), false, `should reject: ${JSON.stringify(bad)}`);
  }
});

test("generated PINs are always valid 6-digit strings", () => {
  for (let i = 0; i < 200; i++) assert.equal(isValidPinFormat(generatePin()), true);
});
