// The follow-up engine only emails clients, so the important checks are the
// ones about NOT sending: paused, stopped, closed and un-proposed deals must
// never be chased, and a second run must not double-send.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, users } from "../src/db/schema";
import { dueFollowups, previewFollowups, composeFollowup, runFollowups } from "../src/lib/followup";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms);

async function main() {
  const db = getDb();
  const [actor] = await db.select().from(users).limit(1);
  const ids: string[] = [];

  async function make(tag: string, over: Partial<typeof opportunities.$inferInsert>) {
    const [o] = await db.insert(opportunities).values({
      code: `FUTEST-${tag}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      company: `Followup ${tag}`,
      firstName: "Sam", lastName: "Doe",
      email: `${tag.toLowerCase()}@futest.invalid`,
      eventName: "Annual Gala", eventDate: "May 1, 2027",
      ownerId: actor.id, createdById: actor.id,
      stage: "proposal_sent",
      proposalSentAt: ago(5 * DAY),
      followupState: "active",
      followupDueAt: ago(1 * DAY),
      followupStep: 0,
      ...over,
    }).returning();
    ids.push(o.id);
    return o;
  }

  const active = await make("ACTIVE", {});
  await make("PAUSED", { followupState: "paused" });
  await make("STOPPED", { followupState: "stopped" });
  await make("WON", { stage: "won", wonAt: new Date() });
  await make("LOST", { stage: "lost", lostAt: new Date(), lostReason: "budget" });
  await make("NOTDUE", { followupDueAt: new Date(Date.now() + 3 * DAY) });
  await make("NOPROPOSAL", { proposalSentAt: null });
  await make("NOEMAIL", { email: "" });

  console.log("\nWho is picked up");
  const due = await dueFollowups();
  const codes = due.map((d) => d.code);
  const has = (t: string) => codes.some((c) => c.includes(t));

  check("an active, overdue, proposed deal IS due", has("ACTIVE"));
  check("a PAUSED sequence is never chased", !has("PAUSED"));
  check("a STOPPED sequence is never chased", !has("STOPPED"));
  check("a WON deal is never chased", !has("WON"));
  check("a LOST deal is never chased", !has("LOST"));
  check("one not yet due is left alone", !has("NOTDUE"));
  check("a deal with no proposal sent is not chased", !has("NOPROPOSAL"));
  check("a missing email still queues, to be flagged", has("NOEMAIL"));

  console.log("\nWhat it would say");
  const preview = await previewFollowups();
  const first = preview.find((p) => p.code.includes("ACTIVE"))!;
  check("subject names the client", first.subject.includes("Followup ACTIVE"), first.subject);
  check("greets the contact by first name", first.text.startsWith("Hi Sam,"), first.text.slice(0, 20));
  check("references the event", first.text.includes("Annual Gala"));
  check("signed by the owner", first.text.includes(actor.name));
  const blocked = preview.find((p) => p.code.includes("NOEMAIL"))!;
  check("no-email entry is marked blocked", blocked.blocked === "no email address on file", String(blocked.blocked));

  const step3 = composeFollowup({ ...due[0], step: 2 });
  check("the final chase offers a graceful exit", /close it off/i.test(step3.text));

  console.log("\nSafety");
  const run = await runFollowups();
  check("disabled by default — nothing sent", run.enabled === false && run.sent.length === 0);
  check("and it says why", run.skipped.every((s) => /FOLLOWUPS_ENABLED/.test(s.reason)));

  const [after] = await db.select().from(opportunities).where(eq(opportunities.id, active.id));
  check("a disabled run does not advance the step", after.followupStep === 0, String(after.followupStep));
  // Compare against what was actually stored, not a freshly computed "now" —
  // the round trips between creation and here take more than a moment.
  check("and does not move the due date",
    after.followupDueAt?.getTime() === active.followupDueAt?.getTime(),
    `${after.followupDueAt?.toISOString()} vs ${active.followupDueAt?.toISOString()}`);
  check("and leaves the sequence active", after.followupState === "active", after.followupState);

  await db.delete(opportunities).where(inArray(opportunities.id, ids));
  console.log(failures === 0 ? "\nAll follow-up checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
