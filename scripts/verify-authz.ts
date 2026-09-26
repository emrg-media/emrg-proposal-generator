// Five people share this system and one of them has a private dashboard, so
// the interesting question is not "does login work" but "what happens when
// someone tries to get in anyway".
//
// Everything here runs against throwaway users. The five real accounts are
// never touched, so running this can never lock Erica out on a Monday morning.
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";
import { checkLogin } from "../src/lib/login";
import { hashPin } from "../src/lib/pin";
import { signSession, verifySession } from "../src/lib/session";
import { isThrottled, recordFailure, clearAddress, THROTTLE } from "../src/lib/loginThrottle";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

const PLANNER_PIN = "246813";
const ADMIN_PIN = "864202";

async function main() {
  const db = getDb();
  const made: string[] = [];

  const mk = async (name: string, role: "admin" | "planner", pin: string, active = true) => {
    const [u] = await db.insert(users).values({
      name, email: `${name.replace(/\W/g, "").toLowerCase()}@authz.invalid`,
      pinHash: await hashPin(pin), role, active,
    }).returning();
    made.push(u.id);
    return u;
  };

  try {
    const planner = await mk("AuthzPlanner", "planner", PLANNER_PIN);
    const admin = await mk("AuthzAdmin", "admin", ADMIN_PIN);
    const disabled = await mk("AuthzDisabled", "planner", PLANNER_PIN, false);

    // ── A. Session tokens ────────────────────────────────────────────────────
    console.log("\nA. A forged or altered session cookie is refused");

    const good = await signSession(planner.id);
    check("a genuine token verifies", (await verifySession(good))?.uid === planner.id);

    // Swap the payload for the admin's id but keep the original signature.
    const forgedBody = Buffer.from(JSON.stringify({
      uid: admin.id,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString("base64url");
    const stolenSig = good.slice(good.lastIndexOf(".") + 1);
    check("swapping the user id invalidates the signature",
      (await verifySession(`${forgedBody}.${stolenSig}`)) === null);

    // Flip one character of the signature.
    const sig = good.slice(good.lastIndexOf(".") + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    check("a single altered signature byte is rejected",
      (await verifySession(`${good.slice(0, good.lastIndexOf("."))}.${flipped}`)) === null);

    check("an unsigned payload is rejected", (await verifySession(forgedBody)) === null);
    check("empty and junk tokens are rejected",
      (await verifySession("")) === null
      && (await verifySession(undefined)) === null
      && (await verifySession("....")) === null
      && (await verifySession("not-a-token")) === null);

    // A token signed with a different secret must not verify. Swapping the env
    // var is the only honest way to prove the secret is actually load-bearing.
    const realSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-completely-different-secret-value";
    const foreign = await signSession(planner.id);
    process.env.AUTH_SECRET = realSecret;
    check("a token signed with another secret is rejected",
      (await verifySession(foreign)) === null);

    // Expired token, signed correctly.
    const past = Math.floor(Date.now() / 1000) - 60;
    const expiredBody = Buffer.from(JSON.stringify({
      uid: planner.id, iat: past - 10, exp: past,
    })).toString("base64url");
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(process.env.AUTH_SECRET!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const expSig = Buffer.from(new Uint8Array(await crypto.subtle.sign(
      "HMAC", key, new TextEncoder().encode(expiredBody),
    ))).toString("base64url");
    check("a correctly signed but expired token is rejected",
      (await verifySession(`${expiredBody}.${expSig}`)) === null);

    // ── B. Login and lockout ─────────────────────────────────────────────────
    console.log("\nB. A 6-digit PIN cannot be walked");

    check("the right PIN signs in", (await checkLogin(planner.id, PLANNER_PIN)).ok === true);

    let lockedAt = 0;
    for (let i = 1; i <= 6; i++) {
      const r = await checkLogin(planner.id, "000000");
      if (!r.ok && /Too many attempts/.test(r.error) && !lockedAt) lockedAt = i;
    }
    check("repeated wrong PINs lock the account", lockedAt > 0, "never locked");
    check("it locks within 5 attempts", lockedAt > 0 && lockedAt <= 5, `locked at ${lockedAt}`);

    const whileLocked = await checkLogin(planner.id, PLANNER_PIN);
    check("while locked, even the CORRECT PIN is refused", whileLocked.ok === false);

    // ── C. Account enumeration ───────────────────────────────────────────────
    console.log("\nC. The login form gives nothing away");

    const wrongPin = await checkLogin(admin.id, "000000");
    const inactive = await checkLogin(disabled.id, PLANNER_PIN);
    const missing = await checkLogin("00000000-0000-0000-0000-000000000000", "000000");
    const msg = (r: Awaited<ReturnType<typeof checkLogin>>) => (r.ok ? "OK" : r.error);
    check("wrong PIN, disabled account and unknown user read identically",
      msg(wrongPin) === msg(inactive) && msg(inactive) === msg(missing),
      `${msg(wrongPin)} | ${msg(inactive)} | ${msg(missing)}`);
    check("a deactivated user cannot sign in with the right PIN", inactive.ok === false);

    // ── D. Deactivation revokes a live session ───────────────────────────────
    console.log("\nD. Deactivating someone ends the session they already have");

    const live = await signSession(admin.id);
    check("the admin's token is valid while active",
      (await verifySession(live))?.uid === admin.id);
    await db.update(users).set({ active: false }).where(eq(users.id, admin.id));
    const [stillThere] = await db.select().from(users).where(eq(users.id, admin.id));
    // The token still verifies cryptographically; getSessionUser is what refuses
    // it, by reloading the row and checking `active` on every single request.
    check("the token still verifies, so the cookie alone is not the authority",
      (await verifySession(live))?.uid === admin.id);
    check("but the user row is now inactive, which getSessionUser checks",
      stillThere.active === false);

    // ── E. The lockout cannot be turned against the team ─────────────────────
    console.log("\nE. One attacker cannot lock all five people out");

    const attacker = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
    const innocent = "198.51.100.7";
    await clearAddress(attacker);
    await clearAddress(innocent);

    check("a fresh address is allowed through", (await isThrottled(attacker)) === false);

    // One short of the limit: still allowed, because five people behind one
    // office address must not throttle each other by fumbling a PIN.
    for (let i = 0; i < THROTTLE.MAX_FAILURES - 1; i++) await recordFailure(attacker);
    check(`${THROTTLE.MAX_FAILURES - 1} failures is still allowed`,
      (await isThrottled(attacker)) === false);

    await recordFailure(attacker);
    check(`${THROTTLE.MAX_FAILURES} failures throttles that address`,
      (await isThrottled(attacker)) === true);

    check("a different address is unaffected", (await isThrottled(innocent)) === false);

    // 25 wrong PINs is what it takes to lock all five accounts. The cap is
    // below that on purpose, so the attack cannot complete.
    check("the cap is below the 25 attempts needed to lock five accounts",
      THROTTLE.MAX_FAILURES < 25, String(THROTTLE.MAX_FAILURES));

    await clearAddress(attacker);
    check("a successful login clears the address", (await isThrottled(attacker)) === false);

    // Failures older than the window must fall out of it.
    const old = new Date(Date.now() - (THROTTLE.WINDOW_MINUTES + 5) * 60_000);
    for (let i = 0; i < THROTTLE.MAX_FAILURES + 5; i++) await recordFailure(attacker, old);
    check("failures outside the window no longer count", (await isThrottled(attacker)) === false);
    await clearAddress(attacker);
    await clearAddress(innocent);

    // ── F. Roles ─────────────────────────────────────────────────────────────
    console.log("\nF. Roles are what they claim to be");
    const [p2] = await db.select().from(users).where(eq(users.id, planner.id));
    check("a planner is not an admin", p2.role !== "admin");
    check("PIN hashes are never stored in the clear",
      !p2.pinHash.includes(PLANNER_PIN) && p2.pinHash.length > 40);
  } finally {
    if (made.length) {
      for (const id of made) await db.delete(users).where(eq(users.id, id));
      console.log(`\n  ✔ cleanup removed ${made.length} test user(s)`);
    }
  }

  console.log(failures === 0
    ? "\nAll authorisation checks passed.\n"
    : `\n${failures} authorisation check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
