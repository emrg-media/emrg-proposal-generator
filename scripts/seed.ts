import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { users, settings } from "../src/db/schema";
import { hashPin, generatePin } from "../src/lib/pin";
import { DEFAULT_RESPONSE_TARGET_MINUTES, DEFAULT_FOLLOWUP_CADENCE_DAYS } from "../src/lib/constants";

// Creates the Events team and prints each person's starting PIN ONCE. PINs are
// stored only as scrypt hashes, so this output is the only chance to capture
// them — hand them out, then they can be reset from /admin.
//
// Safe to re-run: existing users are left untouched.

const TEAM = [
  { name: "Mario Stewart", email: "mario@emrgmedia.com", role: "admin" as const },
  { name: "Erica", email: "erica@emrgmedia.com", role: "manager" as const },
  { name: "Victoria", email: "victoria@emrgmedia.com", role: "planner" as const },
  { name: "Amanda", email: "amanda@emrgmedia.com", role: "planner" as const },
  { name: "Mary Jane", email: "maryjane@emrgmedia.com", role: "planner" as const },
];

async function main() {
  const db = getDb();
  const created: Array<{ name: string; email: string; role: string; pin: string }> = [];

  for (const member of TEAM) {
    const [existing] = await db.select().from(users).where(eq(users.email, member.email)).limit(1);
    if (existing) {
      console.log(`  · ${member.name} already exists — left alone`);
      continue;
    }
    const pin = generatePin();
    await db.insert(users).values({ ...member, pinHash: await hashPin(pin) });
    created.push({ ...member, pin });
  }

  const defaults: Array<[string, unknown]> = [
    ["response_target_minutes", DEFAULT_RESPONSE_TARGET_MINUTES],
    ["followup_cadence_days", DEFAULT_FOLLOWUP_CADENCE_DAYS],
  ];
  for (const [key, value] of defaults) {
    await db.insert(settings).values({ key, value }).onConflictDoNothing();
  }

  if (created.length === 0) {
    console.log("\nNo new users. Nothing to hand out.\n");
    return;
  }

  console.log("\n" + "=".repeat(58));
  console.log("  STARTING PINs — shown once, not recoverable afterwards");
  console.log("=".repeat(58));
  for (const u of created) {
    console.log(`  ${u.name.padEnd(16)} ${u.role.padEnd(8)} PIN ${u.pin}`);
  }
  console.log("=".repeat(58));
  console.log("  Give each person their PIN. They can be reset from /admin.");
  console.log("=".repeat(58) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
