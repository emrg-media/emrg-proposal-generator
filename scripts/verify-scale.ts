// Every screen loads the whole table and computes in memory. That is the right
// call at the size this business actually is, but "right at 50 rows" and "right
// at 5,000" are different claims, and only one of them has been tested.
//
// This fills the database in stages and times the queries behind the four
// heaviest screens at each stage, so the ceiling is a measured number rather
// than a hope. Everything it inserts is removed again.
import { inArray, like, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { activities, opportunities, users, type Stage } from "../src/db/schema";
import { listOpportunities, toAttentionInput } from "../src/lib/opportunities";
import { buildAttentionList, groupAttention } from "../src/lib/attention";
import { computeKpis, periodWindow, type KpiInput } from "../src/lib/kpi";
import { buildExport } from "../src/lib/opportunityExport";

const PREFIX = "SCALE-";
// Checkpoints: comfortably past anything EMRG will see in years of trading.
const CHECKPOINTS = [250, 1000, 2500];
// Budgets apply to work the PRODUCTION deployment actually does: time spent
// inside Postgres, and time spent computing in the function. Wall-clock from
// this machine is dominated by a ~250ms round trip over the public internet
// that a same-region Vercel function does not pay, so it is reported for
// information and never failed on.
const DB_BUDGET_MS = 250;       // server-side execution of the heaviest query
const COMPUTE_BUDGET_MS = 750;  // in-function work per screen

const STAGES: Stage[] = [
  "new_lead", "contacted", "proposal_needed", "proposal_review",
  "proposal_sent", "client_reviewing", "contract_deposit", "won", "lost",
];

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${detail ? `  ${detail}` : ""}`);
  if (!ok) failures++;
};

async function time<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const out = await fn();
  return [out, Math.round(performance.now() - t0)];
}

async function main() {
  const db = getDb();
  const team = await db.select().from(users);
  if (team.length === 0) { console.error("No users. Run db:seed first."); process.exit(1); }

  // This machine talks to Neon over the public internet; a Vercel function sits
  // in the same region. Measure the round trip so the numbers below can be read
  // as "query cost + one round trip" rather than mistaken for pure query time.
  const pings: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    await db.execute(sql`select 1`);
    pings.push(performance.now() - t);
  }
  const rtt = Math.round(Math.min(...pings));
  console.log(`\nNetwork round trip to Neon from here: ${rtt} ms (best of 5).`);
  console.log("In production the function runs in the same region, so expect far less.");

  const startedAt = Date.now();
  let made = 0;

  try {
    for (const target of CHECKPOINTS) {
      const need = target - made;
      const batch = [];
      for (let i = 0; i < need; i++) {
        const n = made + i;
        const daysAgo = n % 120;
        const at = new Date(startedAt - daysAgo * 86_400_000);
        batch.push({
          code: `${PREFIX}${String(n).padStart(6, "0")}`,
          company: `Scale Test Company ${n}`,
          firstName: "Test", lastName: `Contact ${n}`,
          email: `scale${n}@scaletest.invalid`,
          leadSource: "Imported from tracker",
          leadReceivedAt: at,
          eventName: `Event ${n}`,
          eventTypes: ["Gala"],
          eventDate: "2027-01-01",
          guestCount: String(100 + (n % 900)),
          venue: `Venue ${n % 40}`,
          feeRaw: n % 3 === 0 ? "20%" : `$${5000 + (n % 50) * 100}`,
          budgetLowCents: 5_000_000, budgetHighCents: 7_500_000,
          proposalValueCents: 800_000 + (n % 100) * 1000,
          ownerId: team[n % team.length].id,
          createdById: team[n % team.length].id,
          stage: STAGES[n % STAGES.length],
          proposalGeneratedAt: at,
          proposalSentAt: n % 2 === 0 ? at : null,
          lastActivityAt: at,
          nextAction: n % 4 === 0 ? "" : "Call the client",
          firstResponseAt: n % 5 === 0 ? null : new Date(at.getTime() + 900_000),
        });
      }
      // Chunked so a single statement never grows unreasonably large.
      const inserted: string[] = [];
      for (let i = 0; i < batch.length; i += 200) {
        const rows = await db.insert(opportunities).values(batch.slice(i, i + 200)).returning({ id: opportunities.id });
        inserted.push(...rows.map((r) => r.id));
      }

      // Two timeline entries each: the volume the attention rules read through.
      const acts = inserted.flatMap((id, i) => [
        { opportunityId: id, type: "proposal_generated" as const, actorId: team[i % team.length].id,
          body: "Generated", occurredAt: new Date(startedAt - (i % 120) * 86_400_000) },
        { opportunityId: id, type: "email_out" as const, actorId: team[i % team.length].id,
          body: "Sent the proposal", occurredAt: new Date(startedAt - (i % 120) * 86_400_000 + 3600_000) },
      ]);
      for (let i = 0; i < acts.length; i += 400) {
        await db.insert(activities).values(acts.slice(i, i + 400));
      }
      made = target;

      console.log(`\n── ${target} opportunities, ${target * 2} timeline entries`);

      // What Postgres itself spends, network excluded. This is the number a
      // production function pays.
      const plan = await db.execute(sql`explain (analyze) select o.*, u.name from opportunities o
         left join users u on u.id = o.owner_id
         left join (select opportunity_id,
                      max(occurred_at) filter (where type = 'email_in') li,
                      max(occurred_at) filter (where type in ('email_out','call','meeting')) lo
                    from activities group by opportunity_id) ct on ct.opportunity_id = o.id
         order by o.last_activity_at desc`);
      const planRows = ((plan as unknown as { rows?: Record<string, string>[] }).rows ?? plan) as Record<string, string>[];
      const execLine = planRows.map((r) => Object.values(r)[0]).find((l) => /Execution Time/.test(l)) ?? "";
      const dbMs = Number(execLine.match(/([\d.]+) ms/)?.[1] ?? "-1");
      check(`Postgres executes the main query in ${dbMs.toFixed(1)} ms`,
        dbMs >= 0 && dbMs < DB_BUDGET_MS, `budget ${DB_BUDGET_MS}ms`);

      const [rows, tList] = await time(() => listOpportunities());
      console.log(`      (wall clock from this machine ${tList} ms, of which ~${rtt * 3} ms is network)`);

      const t1 = performance.now();
      const groups = groupAttention(buildAttentionList(rows.map(toAttentionInput), {
        now: new Date(), responseTargetMinutes: 15,
      }));
      const tAttn = Math.round(performance.now() - t1);
      check(`Needs Attention computes in ${tAttn} ms`, tAttn < COMPUTE_BUDGET_MS,
        `${groups.length} rows flagged`);

      const t2 = performance.now();
      computeKpis(rows as unknown as KpiInput[], periodWindow("month"), { now: new Date(), responseTargetMinutes: 15 });
      const tKpi = Math.round(performance.now() - t2);
      check(`Exec dashboard computes in ${tKpi} ms`, tKpi < COMPUTE_BUDGET_MS);

      const [exp, tExp] = await time(() => buildExport());
      console.log(`      (CSV export wall clock ${tExp} ms for ${exp.rows.length} rows)`);

      check(`every row came back`, rows.length >= target, `${rows.length}`);
    }
  } finally {
    const doomed = await db.select({ id: opportunities.id }).from(opportunities)
      .where(like(opportunities.code, `${PREFIX}%`));
    for (let i = 0; i < doomed.length; i += 500) {
      await db.delete(opportunities)
        .where(inArray(opportunities.id, doomed.slice(i, i + 500).map((d) => d.id)));
    }
    console.log(`\n  ✔ cleanup removed ${doomed.length} test opportunities`);
  }

  console.log(failures === 0
    ? `\nAll scale checks passed. Comfortable well past ${CHECKPOINTS.at(-1)} opportunities.\n`
    : `\n${failures} scale check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
