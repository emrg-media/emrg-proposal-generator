import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { verifyPinHash, isValidPinFormat } from "./pin";

// Credential checking, kept apart from lib/auth.ts on purpose.
//
// auth.ts reaches for cookies() and redirect(), which only exist inside a
// request. This file needs neither, so the lockout can be exercised directly
// by scripts/verify-authz.ts. Anything that can lock the team out on a Monday
// morning should be testable without standing up a server.

export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_MINUTES = 15;

export type LoginResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

/**
 * Check a user's PIN, enforcing a lockout. A 6-digit PIN is only safe with
 * throttling — without it the whole space is walkable in minutes.
 */
export async function checkLogin(userId: string, pin: string): Promise<LoginResult> {
  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  // Same message whether the user is missing, inactive or wrong-PIN, so the
  // login form can't be used to enumerate accounts or probe lockout state.
  const generic = "That PIN doesn't match. Please try again.";
  if (!user || !user.active) return { ok: false, error: generic };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }

  if (!isValidPinFormat(pin) || !(await verifyPinHash(pin, user.pinHash))) {
    const attempts = user.failedAttempts + 1;
    const lock = attempts >= LOCKOUT_THRESHOLD;
    await db.update(users).set({
      failedAttempts: lock ? 0 : attempts,
      lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    }).where(eq(users.id, user.id));

    if (lock) {
      return { ok: false, error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` };
    }
    return { ok: false, error: generic };
  }

  if (user.failedAttempts !== 0 || user.lockedUntil !== null) {
    await db.update(users).set({ failedAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
  }
  return { ok: true, user };
}
