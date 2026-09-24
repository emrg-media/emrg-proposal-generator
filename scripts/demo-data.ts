// Realistic fixtures for verifying the dashboards. Deliberately mirrors the
// examples in Mario's brief so the screens can be checked against what he
// asked for. Re-runnable: clears its own demo records first.
//
//   npm run db:demo          seed
//   npm run db:demo -- wipe  remove only the demo records
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, users } from "../src/db/schema";
import { createOpportunity } from "../src/lib/opportunities";
import { logActivity } from "../src/lib/activity";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms);

async function main() {
  const db = getDb();
  const team = await db.select().from(users);
  const by = (email: string) => {
    const u = team.find((t) => t.email === email);
    if (!u) throw new Error(`Seed users first: npm run db:seed`);
    return u;
  };
  const victoria = by("victoria@emrgmedia.com");
  const amanda = by("amanda@emrgmedia.com");
  const erica = by("erica@emrgmedia.com");
  const maryjane = by("maryjane@emrgmedia.com");

  // Clear previous demo rows (tagged in rawIntake) so this is re-runnable.
  const existing = await db.select({ id: opportunities.id, raw: opportunities.rawIntake })
    .from(opportunities);
  const demoIds = existing.filter((r) => (r.raw as Record<string, unknown>)?.demo === true).map((r) => r.id);
  if (demoIds.length) {
    await db.delete(opportunities).where(inArray(opportunities.id, demoIds));
    console.log(`Removed ${demoIds.length} previous demo record(s).`);
  }
  if (process.argv.includes("wipe")) { console.log("Wiped."); return; }

  const demo = { demo: true };

  // 1. The brief's headline example: a big lead nobody has answered.
  await createOpportunity({
    company: "Google", firstName: "Jane", lastName: "Doe", title: "Events Lead",
    email: "jane.doe@google.test", cellPhone: "212-555-0142",
    leadSource: "Inbound Email", leadReceivedAt: ago(22 * MIN), rawIntake: demo,
    eventName: "Google Holiday Party", eventTypes: ["Holiday Party"],
    eventDate: "December 14, 2026", guestCount: "200", venue: "TBD",
    feeRaw: "$85,000", ownerId: victoria.id,
    requestedServices: ["Entertainment", "AV", "Staffing"],
  }, victoria);

  // 2. Waiting on Erica's approval.
  const goldman = await createOpportunity({
    company: "Goldman Sachs", firstName: "Peter", lastName: "Hale", title: "VP Operations",
    email: "p.hale@gs.test", leadSource: "Referral", leadReceivedAt: ago(4 * DAY), rawIntake: demo,
    eventName: "Partner Summit", eventTypes: ["Client Summit"], eventDate: "March 3, 2027",
    guestCount: "150", venue: "Cipriani", feeRaw: "$62,000",
    ownerId: amanda.id, collaboratorIds: [erica.id],
    stage: "proposal_review", nextAction: "Chase Erica for sign-off",
    nextActionDate: new Date(Date.now() + DAY),
  }, amanda);
  await logActivity({ opportunityId: goldman.id, type: "email_out", actorId: amanda.id, body: "Intro email", occurredAt: ago(4 * DAY - 9 * MIN) });
  await logActivity({ opportunityId: goldman.id, type: "proposal_generated", actorId: amanda.id, body: "Proposal v1 generated", occurredAt: ago(2 * DAY) });
  await logActivity({ opportunityId: goldman.id, type: "approval_requested", actorId: amanda.id, body: "Sent to Erica for approval", occurredAt: ago(2 * DAY) });
  await db.update(opportunities).set({
    approvalState: "waiting", proposalGeneratedAt: ago(2 * DAY),
  }).where(eq(opportunities.id, goldman.id));

  // 3. Client replied — Victoria needs to answer.
  const acme = await createOpportunity({
    company: "Acme Corp", firstName: "Dana", lastName: "Whitfield", title: "Head of Marketing",
    email: "dana@acme.test", leadSource: "Website Form", leadReceivedAt: ago(9 * DAY), rawIntake: demo,
    eventName: "Product Launch", eventTypes: ["Product Launch"], eventDate: "June 2, 2027",
    guestCount: "300", venue: "Brooklyn Navy Yard", feeRaw: "20%",
    budgetLowCents: 12_000_000, budgetHighCents: 18_000_000,
    ownerId: victoria.id, stage: "client_reviewing",
    nextAction: "Answer pricing question", nextActionDate: new Date(Date.now() + 2 * DAY),
  }, victoria);
  await logActivity({ opportunityId: acme.id, type: "email_out", actorId: victoria.id, body: "Replied to enquiry", occurredAt: ago(9 * DAY - 11 * MIN) });
  await logActivity({ opportunityId: acme.id, type: "proposal_sent", actorId: victoria.id, body: "Proposal sent", occurredAt: ago(6 * DAY) });
  await logActivity({ opportunityId: acme.id, type: "email_in", body: "Client asked about the AV line item", occurredAt: ago(6 * HOUR) });
  await db.update(opportunities).set({ proposalSentAt: ago(6 * DAY), proposalGeneratedAt: ago(6 * DAY) })
    .where(eq(opportunities.id, acme.id));

  // 4. Proposal sent four days ago, total silence.
  const abc = await createOpportunity({
    company: "ABC Corp", firstName: "Louis", lastName: "Grant", title: "Office Manager",
    email: "louis@abccorp.test", leadSource: "Referral", leadReceivedAt: ago(11 * DAY), rawIntake: demo,
    eventName: "Annual Meeting", eventTypes: ["Annual Meeting"], eventDate: "Jan 20, 2027",
    guestCount: "80", venue: "The Plaza", feeRaw: "$24,000",
    ownerId: maryjane.id, stage: "proposal_sent",
    nextAction: "Follow up", nextActionDate: ago(DAY),
  }, maryjane);
  await logActivity({ opportunityId: abc.id, type: "call", actorId: maryjane.id, body: "Discovery call", occurredAt: ago(11 * DAY - 25 * MIN) });
  await logActivity({ opportunityId: abc.id, type: "proposal_sent", actorId: maryjane.id, body: "Proposal sent", occurredAt: ago(4 * DAY) });
  await db.update(opportunities).set({ proposalSentAt: ago(4 * DAY), proposalGeneratedAt: ago(4 * DAY) })
    .where(eq(opportunities.id, abc.id));

  // 5. Fifteen days of silence — the worst aging bucket.
  const stale = await createOpportunity({
    company: "Northwind Traders", firstName: "Celia", lastName: "Mbeki", title: "COO",
    email: "celia@northwind.test", leadSource: "Cold Outreach", leadReceivedAt: ago(30 * DAY), rawIntake: demo,
    eventName: "Awards Gala", eventTypes: ["Awards Gala"], eventDate: "Nov 8, 2026",
    guestCount: "420", venue: "Gotham Hall", feeRaw: "$96,000",
    ownerId: amanda.id, stage: "proposal_sent",
  }, amanda);
  await logActivity({ opportunityId: stale.id, type: "email_out", actorId: amanda.id, body: "Intro", occurredAt: ago(30 * DAY - 45 * MIN) });
  await logActivity({ opportunityId: stale.id, type: "proposal_sent", actorId: amanda.id, body: "Proposal sent", occurredAt: ago(17 * DAY) });
  await db.update(opportunities).set({
    proposalSentAt: ago(17 * DAY), proposalGeneratedAt: ago(17 * DAY),
    followupState: "active", followupDueAt: ago(3 * DAY),
  }).where(eq(opportunities.id, stale.id));

  // 6. Nobody owns it and nothing is scheduled.
  await createOpportunity({
    company: "Harbour Foundation", firstName: "Sam", lastName: "Oyelaran",
    email: "sam@harbour.test", leadSource: "Event Networking", leadReceivedAt: ago(2 * DAY), rawIntake: demo,
    eventName: "Holiday Gala", eventTypes: ["Charity Gala"], eventDate: "Dec 6, 2026",
    guestCount: "260", feeRaw: "18-22%", budgetLowCents: 9_000_000, budgetHighCents: 14_000_000,
    ownerId: null, stage: "new_lead",
  }, erica);

  // 6b. Ready to quote, but the planner never captured an email address. Shows
  //     the missing-information check doing its job: the proposal physically
  //     cannot be sent, and Needs Attention says so.
  const noEmail = await createOpportunity({
    company: "Everline Group", firstName: "Tomas", lastName: "Reyes", title: "Chief of Staff",
    email: "", cellPhone: "917-555-0143",
    leadSource: "Phone Call", leadReceivedAt: ago(6 * HOUR), rawIntake: demo,
    eventName: "Leadership Offsite", eventTypes: ["Executive Retreat"],
    eventDate: "May 21, 2027", guestCount: "60", venue: "TBD",
    feeRaw: "$18,000", ownerId: maryjane.id,
    stage: "proposal_needed",
    nextAction: "Get an email address from Tomas",
    nextActionDate: new Date(Date.now() + DAY),
  }, maryjane);
  await logActivity({ opportunityId: noEmail.id, type: "call", actorId: maryjane.id, body: "Took the brief over the phone", occurredAt: ago(6 * HOUR - 4 * MIN) });

  // 7. A healthy deal: answered fast, moving along. Should NOT appear.
  const healthy = await createOpportunity({
    company: "Vertex Labs", firstName: "Priya", lastName: "Raman", title: "Chief of Staff",
    email: "priya@vertex.test", leadSource: "Repeat Client", leadReceivedAt: ago(3 * DAY), rawIntake: demo,
    eventName: "Investor Day", eventTypes: ["Investor Event"], eventDate: "Feb 11, 2027",
    guestCount: "120", venue: "Guastavino's", feeRaw: "$38,000",
    ownerId: victoria.id, stage: "contacted",
    nextAction: "Send venue options", nextActionDate: new Date(Date.now() + 3 * DAY),
  }, victoria);
  await logActivity({ opportunityId: healthy.id, type: "email_out", actorId: victoria.id, body: "Replied", occurredAt: ago(3 * DAY - 7 * MIN) });

  // 8. Won.
  const won = await createOpportunity({
    company: "Sterling Financial", firstName: "Marcus", lastName: "Webb", title: "Director",
    email: "m.webb@sterling.test", leadSource: "Referral", leadReceivedAt: ago(45 * DAY), rawIntake: demo,
    eventName: "Employee Appreciation Night", eventTypes: ["Employee Appreciation Event"],
    eventDate: "Oct 30, 2026", guestCount: "340", venue: "Chelsea Piers", feeRaw: "$71,500",
    ownerId: victoria.id,
  }, victoria);
  await logActivity({ opportunityId: won.id, type: "email_out", actorId: victoria.id, body: "Replied", occurredAt: ago(45 * DAY - 6 * MIN) });
  await logActivity({ opportunityId: won.id, type: "proposal_sent", actorId: victoria.id, body: "Proposal sent", occurredAt: ago(38 * DAY) });
  await logActivity({ opportunityId: won.id, type: "won", actorId: victoria.id, body: "Marked won", occurredAt: ago(20 * DAY) });
  await db.update(opportunities).set({
    stage: "won", wonAt: ago(20 * DAY), proposalSentAt: ago(38 * DAY), proposalGeneratedAt: ago(38 * DAY),
  }).where(eq(opportunities.id, won.id));

  // 9. Lost, with a reason — kept forever.
  const lost = await createOpportunity({
    company: "Brightpath Health", firstName: "Nina", lastName: "Alvarez", title: "Events Manager",
    email: "nina@brightpath.test", leadSource: "Website Form", leadReceivedAt: ago(60 * DAY), rawIntake: demo,
    eventName: "Leadership Retreat", eventTypes: ["Corporate Retreat"], eventDate: "Sep 9, 2026",
    guestCount: "75", feeRaw: "$29,000", ownerId: amanda.id,
  }, amanda);
  await logActivity({ opportunityId: lost.id, type: "email_out", actorId: amanda.id, body: "Replied", occurredAt: ago(60 * DAY - 90 * MIN) });
  await logActivity({ opportunityId: lost.id, type: "lost", actorId: amanda.id, body: "Marked lost — budget", occurredAt: ago(31 * DAY) });
  await db.update(opportunities).set({
    stage: "lost", lostAt: ago(31 * DAY), lostReason: "budget", lostNote: "Went with an in-house team.",
    proposalSentAt: ago(50 * DAY), proposalGeneratedAt: ago(50 * DAY),
  }).where(eq(opportunities.id, lost.id));

  const total = await db.select().from(opportunities);
  console.log(`\nDemo data ready — ${total.length} opportunities in the database.\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
