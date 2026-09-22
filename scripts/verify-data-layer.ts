// Integration check against a real Postgres: proves the derived fields the
// dashboards depend on are actually written. Creates its own data and cleans up.
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, users } from "../src/db/schema";
import { createOpportunity, listOpportunities, getOpportunity, changeStage, markLost } from "../src/lib/opportunities";
import { logActivity, speedToLeadMs, formatDuration } from "../src/lib/activity";

let failures = 0;
function check(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "  ✔" : "  ✖"} ${label}${cond ? "" : `  <- ${detail}`}`);
  if (!cond) failures++;
}

async function main() {
  const db = getDb();
  const [actor] = await db.select().from(users).where(eq(users.email, "victoria@emrgmedia.com")).limit(1);
  if (!actor) throw new Error("Seed the database first: npm run db:seed");

  const leadAt = new Date(Date.now() - 60 * 60 * 1000); // one hour ago

  console.log("\ncreate + speed to lead");
  const opp = await createOpportunity({
    company: "Verify Corp", firstName: "Jane", lastName: "Doe", email: "jane@verify.test",
    leadSource: "Inbound Email", leadReceivedAt: leadAt,
    eventTypes: ["Holiday Party"], guestCount: "200",
    feeRaw: "20%", budgetLowCents: 5_000_000, budgetHighCents: 10_000_000,
    ownerId: actor.id,
  }, actor);

  check("code generated", /^EMRG-\d{8}-[A-Z0-9]{4}$/.test(opp.code), opp.code);
  check("percentage fee resolved to dollars", opp.proposalValueCents === 1_500_000, String(opp.proposalValueCents));
  check("percentage fee flagged as an estimate", opp.valueEstimated === true);
  check("no first response yet", opp.firstResponseAt === null);

  // A human replies 22 minutes after the lead arrived.
  const replyAt = new Date(leadAt.getTime() + 22 * 60 * 1000);
  await logActivity({ opportunityId: opp.id, type: "email_out", actorId: actor.id, body: "Replied", occurredAt: replyAt });

  let [row] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
  check("firstResponseAt stamped by the activity logger", row.firstResponseAt?.getTime() === replyAt.getTime());
  check("speed to lead = 22 minutes", formatDuration(speedToLeadMs(row)) === "22m", formatDuration(speedToLeadMs(row)));

  // A second outbound must NOT move the original response time.
  await logActivity({ opportunityId: opp.id, type: "email_out", actorId: actor.id, body: "Chaser" });
  [row] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
  check("a later email does not overwrite firstResponseAt", row.firstResponseAt?.getTime() === replyAt.getTime());

  console.log("\nhuman takeover");
  await db.update(opportunities).set({ followupState: "active" }).where(eq(opportunities.id, opp.id));
  await logActivity({ opportunityId: opp.id, type: "email_in", body: "Client wrote back" });
  [row] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
  check("an active sequence pauses on a real conversation", row.followupState === "paused", row.followupState);
  check("pause reason recorded", row.followupPausedReason === "Human conversation active");

  const detail = await getOpportunity(opp.id);
  check("pause is on the timeline", detail!.timeline.some((t) => t.activity.type === "followup_paused"));

  console.log("\nlist query (SQL aggregate join)");
  const list = await listOpportunities();
  const listed = list.find((r) => r.id === opp.id)!;
  check("opportunity appears in the list", !!listed);
  check("owner name joined", listed.ownerName === actor.name, String(listed.ownerName));
  check("lastInboundAt derived from activities", listed.lastInboundAt !== null);
  check("lastOutboundAt derived from activities", listed.lastOutboundAt !== null);
  check("inbound is newer than the first outbound", listed.lastInboundAt! > replyAt);

  console.log("\nstage + lost");
  await changeStage(opp.id, "proposal_sent", actor);
  await markLost(opp.id, "budget", "Came in over budget", actor);
  [row] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
  check("stage is lost", row.stage === "lost");
  check("lost reason stored", row.lostReason === "budget");
  check("lostAt stamped", row.lostAt !== null);
  check("follow-up stopped on a dead deal", row.followupState === "stopped");

  const after = await getOpportunity(opp.id);
  const types = after!.timeline.map((t) => t.activity.type);
  const expected = ["lead_received", "email_out", "email_in", "stage_change", "lost"] as const;
  check("timeline holds the full history", expected.every((t) => types.includes(t)), types.join(","));

  // Clean up (cascades to activities and collaborators).
  await db.delete(opportunities).where(eq(opportunities.id, opp.id));
  const gone = await getOpportunity(opp.id);
  check("cleanup removed the test record", gone === null);

  console.log(failures === 0 ? "\nAll data-layer checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
