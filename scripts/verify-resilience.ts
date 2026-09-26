// Failure injection.
//
// The suites next door prove the happy paths work. This one breaks things on
// purpose, because "used by five people every day" means the interesting
// question is what happens when something downstream misbehaves at 9am.
import { sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { users } from "../src/db/schema";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

interface PoolLike {
  listenerCount(event: string): number;
  emit(event: string, ...args: unknown[]): boolean;
  options: Record<string, unknown>;
}

async function main() {
  const db = getDb();
  const pool = (db as unknown as { $client: PoolLike }).$client;

  // ── A. A dropped idle connection must not take the process down ───────────
  console.log("\nA. Neon dropping an idle connection does not crash the app");

  check("the pool has an 'error' listener attached", pool.listenerCount("error") > 0,
    "without one, Node turns a dropped socket into an uncaught exception");

  // pg emits this on the pool whenever an IDLE client's socket dies. With no
  // listener this line alone would terminate the process, which is the whole
  // point of the check above.
  let survived = true;
  try {
    pool.emit("error", Object.assign(new Error("simulated: terminated unexpectedly"), {
      code: "ECONNRESET",
    }), null);
  } catch {
    survived = false;
  }
  check("emitting a dropped-connection error is handled, not thrown", survived);

  const after = await db.select().from(users).limit(1);
  check("the pool still serves queries afterwards", after.length >= 0);

  // ── B. Connection attempts are bounded ────────────────────────────────────
  console.log("\nB. A hung database does not hold a function open");

  const connectTimeout = Number(pool.options.connectionTimeoutMillis ?? 0);
  check(`connect attempts time out (${connectTimeout} ms)`,
    connectTimeout > 0 && connectTimeout <= 30_000,
    "unset means a hung connect waits for the whole 300s duration budget");

  const idleTimeout = Number(pool.options.idleTimeoutMillis ?? 0);
  check(`idle clients are reaped (${idleTimeout} ms)`, idleTimeout > 0);

  // ── C. Failing closed ─────────────────────────────────────────────────────
  console.log("\nC. Missing configuration fails closed, never open");

  const saved = process.env.FOLLOWUPS_ENABLED;
  delete process.env.FOLLOWUPS_ENABLED;
  const { runFollowups } = await import("../src/lib/followup");
  const run = await runFollowups();
  check("with FOLLOWUPS_ENABLED unset, nothing is sent",
    run.enabled === false && run.sent.length === 0, JSON.stringify(run.sent));
  process.env.FOLLOWUPS_ENABLED = saved;

  process.env.FOLLOWUPS_ENABLED = "yes";  // anything other than the exact string
  const loose = await runFollowups();
  check('only the exact string "true" enables sending, not "yes"',
    loose.enabled === false && loose.sent.length === 0);
  if (saved === undefined) delete process.env.FOLLOWUPS_ENABLED;
  else process.env.FOLLOWUPS_ENABLED = saved;

  // ── D. The database is reachable and sane ─────────────────────────────────
  console.log("\nD. Baseline");
  const [{ n }] = (await db.execute(sql`select 1 as n`)).rows as unknown as { n: number }[];
  check("a trivial query round trips", Number(n) === 1);

  console.log(failures === 0
    ? "\nAll resilience checks passed.\n"
    : `\n${failures} resilience check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
