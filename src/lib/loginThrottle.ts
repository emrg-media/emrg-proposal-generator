import "server-only";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { loginAttempts } from "@/db/schema";

// Throttle by source address, in front of the per-account lockout.
//
// The account lockout (lib/login.ts) is what stops a 6-digit PIN being
// guessed, and it must stay. But it locks the ACCOUNT, and /login publishes
// every user's id so each person can tap their own name, so on its own it
// hands anyone who finds the URL a way to keep all five people out: 25 wrong
// PINs locks everybody, repeat every 15 minutes. Stopping the address first
// means an attacker never gets far enough to move a real account's counter.
//
// The window is deliberately generous. All five of them may sit behind one
// office address, and a shared address must not be throttled by ordinary
// fumbling. Twenty failures in fifteen minutes is far more than five people
// mistyping a PIN they know, and far less than the twenty-five an attacker
// needs to lock the whole team out.

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 20;

/** Best-effort client address. Spoofable, which is why this is a throttle and not a gate. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_MINUTES * 60_000);
}

/** True when this address has failed too often to be given another try yet. */
export async function isThrottled(ip: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), gt(loginAttempts.occurredAt, windowStart(now))));
  return (row?.n ?? 0) >= MAX_FAILURES;
}

export async function recordFailure(ip: string, now: Date = new Date()): Promise<void> {
  const db = getDb();
  await db.insert(loginAttempts).values({ ip, occurredAt: now });
  // Opportunistic prune, so this table never needs a scheduled job. Cheap
  // because of the (ip, occurred_at) index and it only ever runs on a failure.
  await db.delete(loginAttempts).where(lt(loginAttempts.occurredAt, windowStart(now)));
}

/** A successful login clears the address, so one bad week is not held against it. */
export async function clearAddress(ip: string): Promise<void> {
  await getDb().delete(loginAttempts).where(eq(loginAttempts.ip, ip));
}

export const THROTTLE = { WINDOW_MINUTES, MAX_FAILURES };
