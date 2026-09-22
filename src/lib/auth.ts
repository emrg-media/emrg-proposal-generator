import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "./session";
import { verifyPinHash, isValidPinFormat } from "./pin";

export { hashPin, verifyPinHash, isValidPinFormat, generatePin } from "./pin";

// Authorisation layer. Every Server Action, route handler and page calls
// requireUser() (or requireAdmin()) at the top. Server Actions are reachable by
// direct POST, not only through the UI, so this check can never be skipped —
// proxy.ts only does a cheap optimistic signature check.

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;

// ── Login ────────────────────────────────────────────────────────────────────

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

// ── Reading the current user ─────────────────────────────────────────────────

/** The signed-in user, or null. Never throws — use requireUser() to enforce. */
export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token);
  if (!payload) return null;

  const db = getDb();
  const [user] = await db.select().from(users).where(eq(users.id, payload.uid)).limit(1);
  // Deactivating a user revokes their session on the next request.
  if (!user || !user.active) return null;
  return user;
}

/** Redirects to /login when signed out. Call at the top of every protected page. */
export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Mario's screens only. Redirects non-admins away rather than 404ing. */
export async function requireAdmin(): Promise<User> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * For Server Actions and route handlers, which should fail loudly rather than
 * redirect. Throws — the action returns an error to the client.
 */
export async function requireUserOrThrow(): Promise<User> {
  const user = await getSessionUser();
  if (!user) throw new Error("Not signed in.");
  return user;
}

export async function requireAdminOrThrow(): Promise<User> {
  const user = await requireUserOrThrow();
  if (user.role !== "admin") throw new Error("Not authorised.");
  return user;
}

/** Erica (manager) and Mario (admin) can approve proposals. */
export function canApprove(user: User): boolean {
  return user.role === "admin" || user.role === "manager";
}
