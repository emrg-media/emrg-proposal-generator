"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { requireAdminOrThrow } from "@/lib/auth";
import { hashPin, generatePin, isValidPinFormat } from "@/lib/pin";
import { setSetting, setRoutingSettings } from "@/lib/settings";
import { parseRoutingSettings, type RoutingRule } from "@/lib/routing";

// Admin-only. Every action re-checks the role itself — a Server Action is a
// POST endpoint, so being absent from the UI protects nothing on its own.

export type AdminResult =
  | { ok: true; pin?: string }
  | { ok: false; error: string };

function fail(err: unknown): AdminResult {
  return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
}

const ROLES: UserRole[] = ["admin", "manager", "planner"];

export async function createUserAction(
  name: string, email: string, role: string,
): Promise<AdminResult> {
  try {
    await requireAdminOrThrow();
    if (!name.trim()) return { ok: false, error: "A name is required." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return { ok: false, error: "That email doesn't look right." };
    }
    if (!ROLES.includes(role as UserRole)) return { ok: false, error: "Unknown role." };

    const db = getDb();
    const existing = await db.select().from(users)
      .where(eq(users.email, email.trim().toLowerCase())).limit(1);
    if (existing.length) return { ok: false, error: "Someone already has that email address." };

    const pin = generatePin();
    await db.insert(users).values({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role: role as UserRole,
      pinHash: await hashPin(pin),
    });

    revalidatePath("/admin");
    // Returned once so it can be handed over; only the hash is stored.
    return { ok: true, pin };
  } catch (err) { return fail(err); }
}

export async function resetPinAction(userId: string, newPin?: string): Promise<AdminResult> {
  try {
    await requireAdminOrThrow();
    const pin = newPin?.trim() ? newPin.trim() : generatePin();
    if (!isValidPinFormat(pin)) return { ok: false, error: "A PIN must be exactly 6 digits." };

    await getDb().update(users)
      .set({ pinHash: await hashPin(pin), failedAttempts: 0, lockedUntil: null })
      .where(eq(users.id, userId));

    revalidatePath("/admin");
    return { ok: true, pin };
  } catch (err) { return fail(err); }
}

export async function setUserActiveAction(userId: string, active: boolean): Promise<AdminResult> {
  try {
    const admin = await requireAdminOrThrow();
    // Locking yourself out would need another admin to undo.
    if (userId === admin.id && !active) {
      return { ok: false, error: "You can't deactivate your own account." };
    }
    await getDb().update(users).set({ active }).where(eq(users.id, userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function setRoleAction(userId: string, role: string): Promise<AdminResult> {
  try {
    const admin = await requireAdminOrThrow();
    if (!ROLES.includes(role as UserRole)) return { ok: false, error: "Unknown role." };
    if (userId === admin.id && role !== "admin") {
      return { ok: false, error: "You can't remove your own admin access." };
    }
    await getDb().update(users).set({ role: role as UserRole }).where(eq(users.id, userId));
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) { return fail(err); }
}

export async function saveSettingsAction(
  responseTargetMinutes: number, cadence: string,
): Promise<AdminResult> {
  try {
    await requireAdminOrThrow();
    if (!Number.isFinite(responseTargetMinutes) || responseTargetMinutes < 1 || responseTargetMinutes > 10_080) {
      return { ok: false, error: "The response target must be between 1 minute and 7 days." };
    }
    const days = cadence.split(",").map((d) => parseInt(d.trim(), 10)).filter((d) => !isNaN(d) && d > 0);
    if (days.length === 0) return { ok: false, error: "Give at least one follow-up day, e.g. 1, 3, 7." };

    await setSetting("response_target_minutes", Math.round(responseTargetMinutes));
    await setSetting("followup_cadence_days", [...new Set(days)].sort((a, b) => a - b));
    revalidatePath("/admin");
    revalidatePath("/");
    revalidatePath("/exec");
    return { ok: true };
  } catch (err) { return fail(err); }
}

const RULE_KINDS = ["event_type", "lead_source", "value_over", "always"];

export async function saveRoutingAction(payload: {
  relationshipWins: boolean;
  fallbackUserId: string | null;
  rules: RoutingRule[];
}): Promise<AdminResult> {
  try {
    await requireAdminOrThrow();

    for (const r of payload.rules ?? []) {
      if (!RULE_KINDS.includes(r.kind)) return { ok: false, error: `Unknown rule type: ${r.kind}` };
      if (!r.userId) return { ok: false, error: "Every rule needs someone to route to." };
      if ((r.kind === "event_type" || r.kind === "lead_source") && !r.match?.trim()) {
        return { ok: false, error: "That rule needs something to match on." };
      }
      if (r.kind === "value_over" && !(typeof r.minValueCents === "number" && r.minValueCents > 0)) {
        return { ok: false, error: "A value rule needs an amount above zero." };
      }
    }

    // Round-trip through the same guard the reader uses, so nothing can be
    // stored that the router would later choke on.
    await setRoutingSettings(parseRoutingSettings(payload));
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) { return fail(err); }
}
