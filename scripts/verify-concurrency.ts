// The old tracker wrote by row index: read the sheet, find row N, write row N.
// Two planners saving at once could clobber each other. This proves the
// replacement does not, under genuinely simultaneous writes.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { activities, opportunities, users } from "../src/db/schema";
import { createOpportunity, updateOpportunity } from "../src/lib/opportunities";
import { logActivity } from "../src/lib/activity";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

async function main() {
  const db = getDb();
  const team = await db.select().from(users);
  const [a, b] = team;

  console.log("\nA. Ten planners editing ten different opportunities at once");
  const created = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      createOpportunity({ company: `Concurrency Co ${i}`, email: `c${i}@test.invalid`,
        rawIntake: { concurrencyTest: true } }, a)),
  );
  await Promise.all(created.map((o, i) =>
    updateOpportunity(o.id, { venue: `Venue ${i}`, notes: `Note ${i}` }, i % 2 ? a : b)));

  const after = await db.select().from(opportunities)
    .where(inArray(opportunities.id, created.map((o) => o.id)));
  check("all ten writes persisted", after.length === 10, String(after.length));
  check("no row picked up another row's data",
    after.every((r) => {
      const i = Number(r.company.split(" ").pop());
      return r.venue === `Venue ${i}` && r.notes === `Note ${i}`;
    }));

  console.log("\nB. Twenty simultaneous timeline entries on ONE opportunity");
  const target = created[0];
  await Promise.all(Array.from({ length: 20 }, (_, i) =>
    logActivity({ opportunityId: target.id, type: "note", actorId: i % 2 ? a.id : b.id,
      body: `Simultaneous note ${i}` })));

  const logged = await db.select().from(activities)
    .where(eq(activities.opportunityId, target.id));
  const notes = logged.filter((l) => l.body.startsWith("Simultaneous note "));
  check("all twenty entries recorded, none lost", notes.length === 20, String(notes.length));
  check("every entry is distinct",
    new Set(notes.map((n) => n.body)).size === 20, String(new Set(notes.map((n) => n.body)).size));

  console.log("\nC. Two planners editing DIFFERENT fields of the SAME record at once");
  const shared = created[1];
  await Promise.all([
    updateOpportunity(shared.id, { venue: "Cipriani" }, a),
    updateOpportunity(shared.id, { guestCount: "300" }, b),
  ]);
  const [merged] = await db.select().from(opportunities).where(eq(opportunities.id, shared.id));
  // Row-index writes would have lost one of these; a per-column UPDATE keeps both.
  check("both edits survived — neither clobbered the other",
    merged.venue === "Cipriani" && merged.guestCount === "300",
    `venue=${merged.venue} guests=${merged.guestCount}`);

  await db.delete(opportunities).where(inArray(opportunities.id, created.map((o) => o.id)));
  console.log(failures === 0 ? "\nAll concurrency checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
