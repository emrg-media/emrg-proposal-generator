// The inbound email pipeline end to end. The extraction call is real, so this
// needs ANTHROPIC_API_KEY; everything else is the same path a connected inbox
// will take.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, activities } from "../src/db/schema";
import { processInboundEmail, parseRawEmail } from "../src/lib/emailIntake";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

async function main() {
  const db = getDb();
  const made: string[] = [];

  console.log("\nA. Junk never becomes a lead");
  for (const [label, mail] of [
    ["an out of office", { fromEmail: "jane@acme.invalid", subject: "Out of Office: back Monday", body: "I am away until Monday." }],
    ["a bounce", { fromEmail: "mailer-daemon@acme.invalid", subject: "Undeliverable", body: "Delivery failed." }],
    ["a newsletter", { fromEmail: "news@brand.invalid", subject: "Spring range", body: "Shop now. Click here to unsubscribe." }],
  ] as const) {
    const r = await processInboundEmail(mail as never);
    check(`${label} is ignored`, r.action === "ignored", JSON.stringify(r));
  }

  console.log("\nB. A real enquiry becomes an owned opportunity");
  const arrived = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const r1 = await processInboundEmail({
    fromEmail: "priya.raman@northwind-intake.invalid",
    fromName: "Priya Raman",
    subject: "Awards gala next March",
    body: [
      "Hi there,",
      "",
      "We're planning our annual awards gala for March 12th 2027, around 450 guests,",
      "ideally at Cipriani. Budget is somewhere between 90 and 130 thousand.",
      "We'd need entertainment, full AV and staffing.",
      "",
      "Best,",
      "Priya Raman",
      "Chief of Staff, Northwind Aerospace",
    ].join("\n"),
    receivedAt: arrived,
    messageId: "<test-1@intake>",
  });
  check("an opportunity was created", r1.action === "created", JSON.stringify(r1));
  if (r1.action !== "created") { process.exit(1); }
  made.push(r1.opportunityId);

  const [opp] = await db.select().from(opportunities).where(eq(opportunities.id, r1.opportunityId));
  check("sender address captured from the envelope", opp.email === "priya.raman@northwind-intake.invalid");
  check("contact name captured", opp.lastName.includes("Raman"), `${opp.firstName} ${opp.lastName}`);
  check("guest count extracted", opp.guestCount.includes("450"), opp.guestCount);
  check("event date extracted", /2027/.test(opp.eventDate), opp.eventDate);
  check("lead source recorded as email", /email/i.test(opp.leadSource), opp.leadSource);
  check("an owner was chosen with no human present", !!opp.ownerId);
  check("the clock starts when the MAIL arrived, not now",
    Math.abs(opp.leadReceivedAt.getTime() - arrived.getTime()) < 2000,
    opp.leadReceivedAt.toISOString());
  check("no first response yet, so speed to lead is honest", opp.firstResponseAt === null);

  const acts = await db.select().from(activities).where(eq(activities.opportunityId, opp.id));
  check("timeline opens with the lead arriving", acts.some((a) => a.type === "lead_received"));
  check("and records why it was assigned", acts.some((a) => a.type === "owner_change" && /assigned automatically/i.test(a.body)));
  check("the raw email is kept", !!(opp.rawIntake as Record<string, unknown>)?.body);

  console.log("\nC. A reply lands on the existing deal, not a new one");
  const r2 = await processInboundEmail({
    fromEmail: "priya.raman@northwind-intake.invalid",
    subject: "Re: Awards gala next March",
    body: "Quick question on the AV line, can we see options?\n\nOn Mon, EMRG wrote:\n> here is the proposal",
  });
  check("recognised as a reply", r2.action === "reply_logged", JSON.stringify(r2));
  check("on the same opportunity", r2.action === "reply_logged" && r2.opportunityId === opp.id);

  const after = await db.select().from(activities).where(eq(activities.opportunityId, opp.id));
  check("logged as an inbound message", after.some((a) => a.type === "email_in"));
  const [reread] = await db.select().from(opportunities).where(eq(opportunities.id, opp.id));
  check("last contact updated, so it shows as client waiting", reread.lastContactAt !== null);

  console.log("\nD. A forwarded enquiry is credited to the client, not the colleague");
  const r3 = await processInboundEmail({
    fromEmail: "mario@emrgmedia.com",
    fromName: "Mario Stewart",
    subject: "Fwd: Summer party",
    body: [
      "See below.",
      "",
      "---------- Forwarded message ---------",
      "From: Alan Poole <alan@forwardtest.invalid>",
      "Subject: Summer party",
      "",
      "We need a summer party for 180 people in July 2027, budget around 40k.",
    ].join("\n"),
  });
  check("created from the forwarded content", r3.action === "created", JSON.stringify(r3));
  if (r3.action === "created") {
    made.push(r3.opportunityId);
    const [fwd] = await db.select().from(opportunities).where(eq(opportunities.id, r3.opportunityId));
    check("attributed to the client", fwd.email === "alan@forwardtest.invalid", fwd.email);
    check("not to the colleague who forwarded it", fwd.email !== "mario@emrgmedia.com");
  }

  console.log("\nE. Pasted raw email parses its own headers");
  const parsed = parseRawEmail([
    "From: Dana Whitfield <dana@pastetest.invalid>",
    "To: info@emrgmedia.com",
    "Subject: Product launch",
    "Date: Mon, 3 Mar 2027 09:14:00 +0000",
    "",
    "Looking for a product launch for 300 guests.",
  ].join("\n"));
  check("sender parsed", parsed.fromEmail === "dana@pastetest.invalid", parsed.fromEmail);
  check("name parsed", parsed.fromName === "Dana Whitfield", String(parsed.fromName));
  check("subject parsed", parsed.subject === "Product launch", parsed.subject);
  check("date parsed", parsed.receivedAt?.getUTCFullYear() === 2027);
  check("body excludes the headers", !parsed.body.includes("Subject:"), parsed.body.slice(0, 40));

  await db.delete(opportunities).where(inArray(opportunities.id, made));
  console.log(failures === 0 ? "\nAll email intake checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
