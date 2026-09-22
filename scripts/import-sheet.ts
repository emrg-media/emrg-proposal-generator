// One-time migration: the existing "Proposals" tab -> opportunities + proposals.
//
// The old tracker is left completely untouched, so it remains a backup. Run a
// dry run first and read the summary before committing:
//
//   npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/import-sheet.ts
//   npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/import-sheet.ts --commit
import { google } from "googleapis";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, proposals, users } from "../src/db/schema";
import { logActivity } from "../src/lib/activity";
import { computeFee, toCents, parseMoneyToCents } from "../src/lib/fee";
import type { Stage } from "../src/db/schema";

const COMMIT = process.argv.includes("--commit");
const TAB = "Proposals";

// Old sheet statuses -> new pipeline stages.
const STAGE_BY_STATUS: Record<string, Stage> = {
  generated: "proposal_review",
  sent: "proposal_sent",
  viewed: "proposal_sent",
  negotiating: "client_reviewing",
  signed: "won",
  lost: "lost",
};

function parseDate(v: string): Date | null {
  if (!v?.trim()) return null;
  const d = new Date(v.trim());
  return isNaN(d.getTime()) ? null : d;
}

function splitName(full: string): { firstName: string; lastName: string } {
  const parts = (full || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

async function main() {
  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) {
    console.error("GOOGLE_SERVICE_ACCOUNT_KEY and PROPOSAL_LOG_SHEET_ID must be set.");
    process.exit(1);
  }

  const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${TAB}!A2:Q`,
  });
  const raw = (res.data.values ?? []).filter((r) => r[0]);
  console.log(`\nFound ${raw.length} row(s) in the "${TAB}" tab.\n`);

  const db = getDb();
  const team = await db.select().from(users);
  // Match "Prepared By" to a real user by first name; unmatched stays unassigned.
  const findUser = (name: string) => {
    const n = (name || "").trim().toLowerCase();
    if (!n) return null;
    return team.find((u) => u.name.toLowerCase() === n)
      ?? team.find((u) => u.name.toLowerCase().split(" ")[0] === n.split(" ")[0])
      ?? null;
  };

  let created = 0, skipped = 0, withProposal = 0;
  const unmatchedOwners = new Set<string>();

  for (const r of raw) {
    const [
      code, proposalDate, preparedBy, signer, company, email,
      eventTypes, eventDates, guests, venue, budget, fee, status, sentAt, followUp, notes,
    ] = r.map((c: unknown) => (c === undefined || c === null ? "" : String(c)));

    const existing = await db.select().from(opportunities)
      .where(eq(opportunities.code, code)).limit(1);
    if (existing.length) { skipped++; continue; }

    const owner = findUser(preparedBy);
    if (preparedBy && !owner) unmatchedOwners.add(preparedBy);

    const { firstName, lastName } = splitName(signer);
    const stage = STAGE_BY_STATUS[status.trim().toLowerCase()] ?? "proposal_review";
    const generatedAt = parseDate(proposalDate) ?? new Date();
    const sentDate = parseDate(sentAt);

    // Budget arrived as free text like "$50,000 to $75,000".
    const [lowText, highText] = budget.split(/\s+to\s+/i);
    const budgetLowCents = parseMoneyToCents(lowText ?? "");
    const budgetHighCents = parseMoneyToCents(highText ?? "");
    const resolved = computeFee(fee, budget);

    if (!COMMIT) {
      console.log(`  would import ${code}  ${company || signer || "(no name)"}  ${status || "—"}  ${fee || "—"}`);
      created++;
      if (sentDate) withProposal++;
      continue;
    }

    await db.transaction(async (tx) => {
      const [opp] = await tx.insert(opportunities).values({
        code,
        company, firstName, lastName, email,
        leadSource: "Imported from tracker",
        leadReceivedAt: generatedAt,
        rawIntake: { importedFrom: "google-sheet", originalRow: r },
        eventName: eventTypes,
        eventTypes: eventTypes ? eventTypes.split(",").map((s) => s.trim()).filter(Boolean) : [],
        eventDate: eventDates,
        guestCount: guests,
        venue,
        notes: [notes, followUp ? `Next follow-up (imported): ${followUp}` : ""].filter(Boolean).join("\n"),
        feeRaw: fee,
        budgetLowCents, budgetHighCents,
        proposalValueCents: toCents(resolved.value),
        valueEstimated: resolved.estimated,
        ownerId: owner?.id ?? null,
        createdById: owner?.id ?? null,
        stage,
        proposalGeneratedAt: generatedAt,
        proposalSentAt: sentDate,
        wonAt: stage === "won" ? (sentDate ?? generatedAt) : null,
        lostAt: stage === "lost" ? (sentDate ?? generatedAt) : null,
        // Imported rows carry no reason; "other" keeps the NOT NULL-ish
        // reporting honest rather than inventing a cause.
        lostReason: stage === "lost" ? "other" : null,
        lostNote: stage === "lost" ? "Imported from the tracker — reason not recorded." : "",
        lastActivityAt: sentDate ?? generatedAt,
        // The old sheet never captured a first-response time, so speed-to-lead
        // is deliberately left null rather than back-filled with a guess.
        firstResponseAt: null,
      }).returning();

      await tx.insert(proposals).values({
        opportunityId: opp.id,
        version: 1,
        snapshot: { importedFrom: "google-sheet", originalRow: r },
        feeRaw: fee,
        feeCents: toCents(resolved.value),
        generatedById: owner?.id ?? null,
        generatedAt,
        sentAt: sentDate,
        sentTo: sentDate ? email : "",
      });

      await logActivity({
        opportunityId: opp.id, type: "proposal_generated", actorId: owner?.id ?? null,
        body: "Imported from the original tracker", occurredAt: generatedAt,
      }, tx);
      if (sentDate) {
        await logActivity({
          opportunityId: opp.id, type: "proposal_sent", actorId: owner?.id ?? null,
          body: `Proposal sent${email ? ` to ${email}` : ""}`, occurredAt: sentDate,
        }, tx);
      }
    });

    created++;
    if (sentDate) withProposal++;
  }

  console.log(`\n${COMMIT ? "Imported" : "Would import"}: ${created}`);
  console.log(`Already present, skipped: ${skipped}`);
  console.log(`Of those, marked sent: ${withProposal}`);
  if (unmatchedOwners.size) {
    console.log(`\nNo matching user for: ${[...unmatchedOwners].join(", ")}`);
    console.log("Those opportunities will be unassigned — reassign them in the app.");
  }
  if (!COMMIT) console.log("\nDry run. Re-run with --commit to write.\n");
  else console.log("\nDone. The original sheet was not modified.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
