// The proposal generator is the front door: generating or sending must create
// the opportunity by itself, and a second version must land on the SAME deal
// rather than forking a duplicate.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, proposals, users, activities } from "../src/db/schema";
import { recordGenerated, recordSent, type ProposalPayload } from "../src/lib/recordProposal";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

async function main() {
  const db = getDb();
  const [actor] = await db.select().from(users).limit(1);
  const created: string[] = [];

  const payload = (over: Partial<ProposalPayload> = {}): ProposalPayload => ({
    client_name: "Frontdoor Ltd",
    signer_name: "Dana Cole",
    signer_title: "Head of Events",
    client_email: "dana@frontdoor.test",
    venue: "The Plaza",
    budget_low: "$40,000",
    budget_high: "$60,000",
    service_fee: "20%",
    events: [{ date: "May 3, 2027", eventTypes: ["Awards Gala"], guestCount: "180" }],
    selectedServices: ["Entertainment", "AV"],
    ...over,
  });

  console.log("\nA. Generating with no existing record creates the opportunity");
  const first = await recordGenerated(payload({
    lead_source: "Phone Call",
    enquiry_received_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  }), actor);
  check("a record was created", !!first?.opportunityId);
  created.push(first!.opportunityId);

  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, first!.opportunityId));
  check("version 1", first!.version === 1, String(first!.version));
  check("company carried over", opp.company === "Frontdoor Ltd", opp.company);
  check("contact split into first/last", opp.firstName === "Dana" && opp.lastName === "Cole");
  check("event type captured", opp.eventTypes.includes("Awards Gala"), opp.eventTypes.join(","));
  check("percentage fee resolved (20% of 50k avg)", opp.proposalValueCents === 1_000_000, String(opp.proposalValueCents));
  check("owner is the planner who generated it", opp.ownerId === actor.id);
  check("lead source recorded", opp.leadSource === "Phone Call", opp.leadSource);
  // Created at proposal_needed, then generating advances it one step, which is
  // the brief's order: Proposal Needed -> Proposal Review -> Proposal Sent.
  check("stage advanced to proposal_review", opp.stage === "proposal_review", opp.stage);
  // Stage and approval are separate: reaching Proposal Review must not make it
  // claim it is waiting on Erica when nobody asked for approval.
  check("not falsely marked as awaiting approval", opp.approvalState === "not_required", opp.approvalState);

  // The enquiry came in 26h ago, so the clock must start there, not at "now".
  const ageHours = (Date.now() - opp.leadReceivedAt.getTime()) / 3_600_000;
  check("lead time honours when the enquiry arrived", ageHours > 25 && ageHours < 27, `${ageHours.toFixed(1)}h`);

  const acts = await db.select().from(activities).where(eq(activities.opportunityId, opp.id));
  check("timeline opens with lead received", acts.some((a) => a.type === "lead_received"));
  check("and records the generated proposal", acts.some((a) => a.type === "proposal_generated"));

  console.log("\nB. Regenerating for the same client does NOT fork a duplicate");
  const second = await recordGenerated(payload({ service_fee: "$15,000" }), actor);
  check("same opportunity reused", second!.opportunityId === first!.opportunityId,
    `${second!.opportunityId} vs ${first!.opportunityId}`);
  check("version incremented to 2", second!.version === 2, String(second!.version));

  const versions = await db.select().from(proposals).where(eq(proposals.opportunityId, opp.id));
  check("both versions kept permanently", versions.length === 2, String(versions.length));

  console.log("\nC. A different client DOES get its own record");
  const other = await recordGenerated(payload({
    client_name: "Someone Else Inc", client_email: "other@elsewhere.test",
  }), actor);
  check("separate opportunity created", other!.opportunityId !== first!.opportunityId);
  created.push(other!.opportunityId);

  console.log("\nD. Sending straight from the generator also creates and arms follow-up");
  const sentId = await recordSent(payload({
    client_name: "Direct Send Co", client_email: "direct@send.test",
  }), actor, "direct@send.test", [1, 3, 7]);
  check("record created on send", !!sentId);
  created.push(sentId!);

  const [sentOpp] = await db.select().from(opportunities).where(eq(opportunities.id, sentId!));
  check("stage moved to proposal_sent", sentOpp.stage === "proposal_sent", sentOpp.stage);
  check("proposalSentAt stamped", sentOpp.proposalSentAt !== null);
  check("follow-up armed, not paused by its own email", sentOpp.followupState === "active", sentOpp.followupState);
  check("first follow-up due in ~1 day",
    !!sentOpp.followupDueAt && Math.round((sentOpp.followupDueAt.getTime() - Date.now()) / 86_400_000) === 1);
  check("the proposal email counts as first response", sentOpp.firstResponseAt !== null);

  await db.delete(opportunities).where(inArray(opportunities.id, created));
  console.log(failures === 0 ? "\nAll generator-intake checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
