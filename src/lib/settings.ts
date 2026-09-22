import "server-only";
import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_RESPONSE_TARGET_MINUTES, DEFAULT_FOLLOWUP_CADENCE_DAYS } from "./constants";

// Tunables the team can change from /admin without a deploy.

export interface AppSettings {
  responseTargetMinutes: number;
  followupCadenceDays: number[];
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await getDb().select().from(settings)
    .where(inArray(settings.key, ["response_target_minutes", "followup_cadence_days"]));
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const target = map.get("response_target_minutes");
  const cadence = map.get("followup_cadence_days");

  return {
    responseTargetMinutes:
      typeof target === "number" && target > 0 ? target : DEFAULT_RESPONSE_TARGET_MINUTES,
    followupCadenceDays:
      Array.isArray(cadence) && cadence.every((d) => typeof d === "number")
        ? (cadence as number[])
        : DEFAULT_FOLLOWUP_CADENCE_DAYS,
  };
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await getDb().insert(settings).values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
