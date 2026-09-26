import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type User } from "@/db/schema";
import { SESSION_COOKIE, verifySession } from "./session";

export { hashPin, verifyPinHash, isValidPinFormat, generatePin } from "./pin";
export { checkLogin, type LoginResult } from "./login";

// Authorisation layer. Every Server Action, route handler and page calls
// requireUser() (or requireAdmin()) at the top. Server Actions are reachable by
// direct POST, not only through the UI, so this check can never be skipped —
// proxy.ts only does a cheap optimistic signature check.

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
