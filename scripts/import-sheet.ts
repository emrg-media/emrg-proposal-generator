// One-time migration: the existing "Proposals" tracker -> opportunities + proposals.
//
// The old tracker is left completely untouched, so it remains a backup. Run a
// dry run first and read the summary before committing.
//
// Two sources, same importer:
//
//   From a CSV export (no Google credentials needed — in the Sheet use
//   File > Download > Comma-separated values, then):
//     npm run db:import -- --csv ~/Downloads/Proposals.csv
//     npm run db:import -- --csv ~/Downloads/Proposals.csv --commit
//
//   Straight from the Sheet (needs GOOGLE_SERVICE_ACCOUNT_KEY and
//   PROPOSAL_LOG_SHEET_ID):
//     npm run db:import
//     npm run db:import -- --commit
//
// Columns are matched by HEADER NAME, not position, so a reordered or
// inserted column cannot silently shift every value one to the left.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { opportunities, proposals, users } from "../src/db/schema";
import { logActivity } from "../src/lib/activity";
import { computeFee, toCents, parseMoneyToCents } from "../src/lib/fee";
import { parseCsv, mapHeaders } from "../src/lib/csv";
import type { Stage } from "../src/db/schema";

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
const csvAt = argv.indexOf("--csv");
const CSV_PATH = csvAt !== -1 ? argv[csvAt + 1] : null;
const TAB = "Proposals";

// Every spelling the tracker might plausibly use. Matching is case- and
// punctuation-insensitive, so "Event Date(s)" and "event_dates" both land.
const ALIASES: Record<string, string[]> = {
  code:         ["proposal code", "code", "proposal id", "id", "proposal number"],
  proposalDate: ["proposal date", "date created", "created", "date", "generated"],
  preparedBy:   ["prepared by", "owner", "rep", "salesperson", "created by"],
  signer:       ["signer", "contact", "contact name", "client name", "name", "attention"],
  company:      ["company", "company name", "organization", "organisation", "client"],
  email:        ["email", "client email", "contact email", "e-mail"],
  eventTypes:   ["event type", "event types", "type of event", "event"],
  eventDates:   ["event date", "event dates", "date of event"],
  guests:       ["guests", "guest count", "number of guests", "attendees", "headcount"],
  venue:        ["venue", "location"],
  budget:       ["budget", "budget range", "client budget"],
  fee:          ["fee", "service fee", "management fee", "proposal value", "value", "amount"],
  status:       ["status", "stage", "outcome"],
  sentAt:       ["sent at", "date sent", "sent date", "sent"],
  followUp:     ["follow up", "next follow up", "follow up date", "followup"],
  notes:        ["notes", "note", "comments", "remarks"],
};

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
  const s = (full || "").trim();
  if (!s) return { firstName: "", lastName: "" };

  // Some rows are written "Stewart, Jane" rather than "Jane Stewart". Without
  // this the comma ends up inside the first name and the two are swapped.
  if (s.includes(",")) {
    const [last, first] = s.split(",", 2).map((x) => x.trim());
    if (last && first) return { firstName: first, lastName: last };
  }

  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: "", lastName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/** Header row + data rows, from whichever source was requested. */
async function loadTable(): Promise<{ header: string[]; rows: string[][]; source: string }> {
  if (CSV_PATH) {
    let text: string;
    try {
      text = readFileSync(CSV_PATH, "utf8");
    } catch {
      console.error(`Could not read ${CSV_PATH}`);
      process.exit(1);
    }
    const all = parseCsv(text);
    if (all.length === 0) { console.error("That CSV is empty."); process.exit(1); }
    return { header: all[0], rows: all.slice(1), source: CSV_PATH };
  }

  const keyB64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const sheetId = process.env.PROPOSAL_LOG_SHEET_ID;
  if (!keyB64 || !sheetId) {
    console.error(
      "No source. Either pass --csv <file> (File > Download > CSV in the Sheet),\n" +
      "or set GOOGLE_SERVICE_ACCOUNT_KEY and PROPOSAL_LOG_SHEET_ID to read it directly.",
    );
    process.exit(1);
  }

  // Imported lazily so the CSV path needs neither the package nor credentials.
  const { google } = await import("googleapis");
  const credentials = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId, range: `${TAB}!A1:Z`,
  });
  const all = (res.data.values ?? []).map((r) =>
    r.map((c: unknown) => (c === undefined || c === null ? "" : String(c))));
  if (all.length === 0) { console.error(`The "${TAB}" tab is empty.`); process.exit(1); }
  return { header: all[0], rows: all.slice(1), source: `the "${TAB}" tab` };
}

async function main() {
  const { header, rows: allRows, source } = await loadTable();
  const { index, unmatched, missing } = mapHeaders(header, ALIASES);

  // Without a code column rows cannot be de-duplicated, and re-running would
  // import everything twice. Note that column 0 is falsy, so test for undefined.
  if (index.code === undefined) {
    console.error(`No proposal-code column found. Headers seen: ${header.join(", ")}`);
    process.exit(1);
  }

  const get = (row: string[], field: string): string => {
    const at = index[field];
    if (at === undefined) return "";
    return (row[at] ?? "").trim();
  };

  // A row with no proposal code is a blank or a totals line, not a deal.
  const rows = allRows.filter((r) => get(r, "code"));

  console.log(`\nReading ${source}`);
  console.log(`${rows.length} data row(s), ${header.length} column(s).\n`);

  if (missing.length) {
    console.log(`Columns not found, these will import blank: ${missing.join(", ")}`);
  }
  if (unmatched.length) {
    console.log(`Columns in the file that nothing maps to: ${unmatched.join(", ")}`);
    console.log("If one of those matters, tell me and I will map it before you commit.");
  }
  if (missing.length || unmatched.length) console.log("");

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

  for (const r of rows) {
    const code = get(r, "code");
    const preparedBy = get(r, "preparedBy");
    const signer = get(r, "signer");
    const company = get(r, "company");
    const email = get(r, "email");
    const eventTypes = get(r, "eventTypes");
    const eventDates = get(r, "eventDates");
    const guests = get(r, "guests");
    const venue = get(r, "venue");
    const budget = get(r, "budget");
    const fee = get(r, "fee");
    const status = get(r, "status");
    const followUp = get(r, "followUp");
    const notes = get(r, "notes");

    const existing = await db.select().from(opportunities)
      .where(eq(opportunities.code, code)).limit(1);
    if (existing.length) { skipped++; continue; }

    const owner = findUser(preparedBy);
    if (preparedBy && !owner) unmatchedOwners.add(preparedBy);

    const { firstName, lastName } = splitName(signer);
    const stage = STAGE_BY_STATUS[status.toLowerCase()] ?? "proposal_review";
    const generatedAt = parseDate(get(r, "proposalDate")) ?? new Date();
    const sentDate = parseDate(get(r, "sentAt"));

    // Budget arrived as free text like "$50,000 to $75,000".
    const [lowText, highText] = budget.split(/\s+to\s+/i);
    const budgetLowCents = parseMoneyToCents(lowText ?? "");
    const budgetHighCents = parseMoneyToCents(highText ?? "");
    const resolved = computeFee(fee, budget);

    if (!COMMIT) {
      const who = company || signer || "(no name)";
      console.log(
        `  would import ${code.padEnd(18)} ${who.slice(0, 28).padEnd(28)} ` +
        `${(status || "-").padEnd(12)} ${fee || "-"}`,
      );
      created++;
      if (sentDate) withProposal++;
      continue;
    }

    // The raw row is kept verbatim so nothing in the original is lost, even
    // the columns this importer does not understand.
    const rawRow = Object.fromEntries(header.map((h, j) => [h || `col${j + 1}`, r[j] ?? ""]));

    await db.transaction(async (tx) => {
      const [opp] = await tx.insert(opportunities).values({
        code,
        company, firstName, lastName, email,
        leadSource: "Imported from tracker",
        leadReceivedAt: generatedAt,
        rawIntake: { importedFrom: CSV_PATH ? "csv-export" : "google-sheet", originalRow: rawRow },
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
        // Imported rows carry no reason; "other" keeps the reporting honest
        // rather than inventing a cause.
        lostReason: stage === "lost" ? "other" : null,
        lostNote: stage === "lost" ? "Imported from the tracker, reason not recorded." : "",
        lastActivityAt: sentDate ?? generatedAt,
        // The old sheet never captured a first-response time, so speed-to-lead
        // is deliberately left null rather than back-filled with a guess.
        firstResponseAt: null,
      }).returning();

      await tx.insert(proposals).values({
        opportunityId: opp.id,
        version: 1,
        snapshot: { importedFrom: CSV_PATH ? "csv-export" : "google-sheet", originalRow: rawRow },
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
    console.log("Those opportunities will be unassigned. Reassign them in the app.");
  }
  if (!COMMIT) console.log("\nDry run. Nothing was written. Re-run with --commit to import.\n");
  else console.log("\nDone. The original tracker was not modified.\n");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
