// Routing against a real database: the relationship lookup and workload counts
// are SQL, so the pure unit tests cannot prove those.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, users, opportunityCollaborators } from "../src/db/schema";
import { decideOwner } from "../src/lib/routingService";
import { setRoutingSettings, getRoutingSettings } from "../src/lib/settings";
import { recordGenerated } from "../src/lib/recordProposal";
import { newRuleId, DEFAULT_ROUTING } from "../src/lib/routing";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "  ✔" : "  ✖"} ${label}${ok ? "" : `  <- ${detail}`}`);
  if (!ok) failures++;
};

async function main() {
  const db = getDb();
  const team = await db.select().from(users).orderBy(users.createdAt, users.id);
  const victoria = team.find((u) => u.email === "victoria@emrgmedia.com")!;
  const amanda = team.find((u) => u.email === "amanda@emrgmedia.com")!;
  const erica = team.find((u) => u.email === "erica@emrgmedia.com")!;
  const original = await getRoutingSettings();
  const ids: string[] = [];

  // A prior deal establishing a relationship.
  const [prior] = await db.insert(opportunities).values({
    code: `ROUTE-PRIOR-${Date.now().toString(36)}`,
    company: "Relationship Ltd", email: "kim@relationship.invalid",
    ownerId: victoria.id, createdById: victoria.id, stage: "won",
  }).returning();
  ids.push(prior.id);

  console.log("\nA. An existing client goes back to the planner who knows them");
  let d = await decideOwner({
    company: "Relationship Ltd", email: "kim@relationship.invalid",
    eventTypes: ["Holiday Party"], leadSource: "Referral", valueCents: 2_000_000,
  }, amanda.id);
  check("routed to Victoria, not the person entering it", d.userId === victoria.id);
  check("Amanda kept on as a collaborator", d.collaboratorIds.includes(amanda.id));
  check("and it explains itself", /existing client/i.test(d.reason), d.reason);

  console.log("\nB. A new contact at a company already worked still matches");
  d = await decideOwner({
    company: "Relationship Ltd", email: "someone.else@relationship.invalid",
    eventTypes: [], leadSource: "", valueCents: null,
  }, amanda.id);
  check("matched on company name", d.userId === victoria.id);

  console.log("\nC. A genuinely new client falls to whoever is entering it");
  d = await decideOwner({
    company: "Totally New Co", email: "new@brandnew.invalid",
    eventTypes: [], leadSource: "", valueCents: null,
  }, amanda.id);
  check("owned by Amanda", d.userId === amanda.id, String(d.userId));

  console.log("\nD. Configured rules beat the person entering it");
  await setRoutingSettings({
    ...DEFAULT_ROUTING,
    rules: [{ id: newRuleId(), kind: "value_over", minValueCents: 5_000_000, userId: erica.id, enabled: true }],
  });
  d = await decideOwner({
    company: "Big Money Inc", email: "big@money.invalid",
    eventTypes: [], leadSource: "", valueCents: 9_000_000,
  }, amanda.id);
  check("a large deal routes to Erica", d.userId === erica.id, String(d.userId));
  check("a small one does not", (await decideOwner({
    company: "Small Co", email: "small@money.invalid", eventTypes: [], leadSource: "", valueCents: 100_000,
  }, amanda.id)).userId === amanda.id);

  console.log("\nE. With nobody driving, the lightest workload takes it");
  await setRoutingSettings({ ...DEFAULT_ROUTING, rules: [] });
  d = await decideOwner({
    company: "Unattended Co", email: "un@attended.invalid", eventTypes: [], leadSource: "", valueCents: null,
  }, null);
  check("someone was chosen", !!d.userId);
  check("chosen on workload", /workload/i.test(d.reason), d.reason);

  console.log("\nF. End to end through the proposal generator");
  const rec = await recordGenerated({
    client_name: "Relationship Ltd", client_email: "kim@relationship.invalid",
    signer_name: "Kim Patel", service_fee: "$20,000",
    events: [{ date: "July 4, 2027", eventTypes: ["Holiday Party"], guestCount: "120" }],
  }, amanda);
  ids.push(rec!.opportunityId);
  const [made] = await db.select().from(opportunities).where(eq(opportunities.id, rec!.opportunityId));
  check("the new opportunity is owned by Victoria", made.ownerId === victoria.id, String(made.ownerId));
  check("but Amanda created it", made.createdById === amanda.id);
  const collabs = await db.select().from(opportunityCollaborators)
    .where(eq(opportunityCollaborators.opportunityId, made.id));
  check("Amanda is a collaborator", collabs.some((c) => c.userId === amanda.id));

  await db.delete(opportunities).where(inArray(opportunities.id, ids));
  await setRoutingSettings(original);
  console.log(failures === 0 ? "\nAll routing checks passed.\n" : `\n${failures} check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
