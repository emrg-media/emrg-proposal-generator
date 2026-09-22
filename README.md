# EMRG Events Revenue System

The operating layer around EMRG's proposal generator.

`LEAD → DATABASE → OWNER → PROPOSAL → FOLLOW-UP → WON / LOST → REPORTING`

The proposal engine itself (the form, the live preview, the PDF) is unchanged. What is new
is everything around it: one permanent record per opportunity, who owns it, what has
happened to it, how fast it was answered, and what needs a human right now.

---

## Screens

| Route | Who | What it is |
|---|---|---|
| `/` | Everyone | **Needs Attention** — a ranked list of what to deal with first |
| `/pipeline` | Everyone | Nine-stage board, drag to move |
| `/opportunity/[id]` | Everyone | One record: details, owner, timeline, actions |
| `/opportunity/[id]/proposal` | Everyone | The proposal generator, pre-filled from the record |
| `/new` | Everyone | Intake — paste a transcript, dictate it, or type it |
| `/proposals` | Everyone | Every proposal ever generated, kept permanently |
| `/closed` | Everyone | Won / Lost with reasons |
| `/data` | Everyone | Spreadsheet view: search, sort, filter, CSV export |
| `/invoice` | Everyone | Invoice builder (unchanged) |
| `/exec` | **Admin only** | Executive KPI dashboard |
| `/admin` | **Admin only** | Team, PINs, response target, follow-up cadence |

## Roles

- **admin** (Mario) — everything, including `/exec` and `/admin`
- **manager** (Erica) — can approve proposals
- **planner** (Victoria, Amanda, Mary Jane) — day-to-day work

Each person signs in with their own 6-digit PIN. Five wrong attempts locks the account for
15 minutes. PINs are stored only as scrypt hashes and are shown exactly once, when created
or reset.

---

## Running it locally

```bash
npm install
```

Point `DATABASE_URL` at a Postgres database and set `AUTH_SECRET`:

```bash
echo 'DATABASE_URL="postgresql://localhost:5432/emrg_crm_dev"' >> .env.local
echo "AUTH_SECRET=\"$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')\"" >> .env.local
```

Create the schema and the team:

```bash
npm run db:push
npm run db:seed
```

`db:seed` prints each person's starting PIN **once**. Write them down.

```bash
npm run dev
```

Optional realistic sample data for checking the dashboards:

```bash
npm run db:demo          # seed nine sample opportunities
npm run db:demo -- wipe  # remove them again
```

## Environment variables

| Variable | Needed for |
|---|---|
| `DATABASE_URL` | Required. Postgres connection string. |
| `AUTH_SECRET` | Required. Signs the session cookie. Use a fresh 32-byte hex value in production. |
| `ANTHROPIC_API_KEY` | Transcript and voice extraction. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_BCC` | Sending proposals. |
| `GOOGLE_SERVICE_ACCOUNT_KEY` / `PROPOSAL_LOG_SHEET_ID` | The read-only Google Sheet mirror. |
| `CRON_SECRET` | Required for the cron endpoints. Without it they refuse every request. |

`APP_PASSCODE` is no longer used — the shared passcode has been replaced by per-user PINs.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | The app |
| `npm test` | Unit tests for the fee, attention, KPI, CSV and session logic |
| `npm run db:push` | Apply the schema |
| `npm run db:generate` / `db:migrate` | Versioned migrations, for production |
| `npm run db:seed` | Create the team, print starting PINs |
| `npm run db:demo` | Realistic sample data |

Verification scripts (each prints a pass/fail checklist):

```bash
npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/verify-data-layer.ts
npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/verify-concurrency.ts
npx dotenv -e .env.local -- npx tsx scripts/check-sheet.ts        # read-only credential check
```

---

## Migrating the old tracker

The original Google Sheet is read but never modified. Dry run first:

```bash
npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/import-sheet.ts
npx dotenv -e .env.local -- npx tsx --conditions=react-server scripts/import-sheet.ts --commit
```

Rows are matched to owners by first name; anything unmatched is left unassigned. The old
sheet never recorded a first-response time, so speed-to-lead is left blank on imported rows
rather than back-filled with a guess.

## The Google Sheet mirror

`/api/cron/mirror` rewrites a tab called **Opportunities (read-only)** from the database,
daily at 05:00 UTC (`vercel.json`). It is one-way and rebuilds the whole tab, so there are
no row-index races — anything typed into that tab is overwritten.

---

## How the pieces fit

Four modules hold the logic that everything else reads. They are pure functions with unit
tests, so the screens, the exports and the future daily brief can never disagree:

- `src/lib/fee.ts` — resolves a quoted fee (`"20%"`, `"$8k-12k"`) to one dollar figure, and
  flags when that figure is an estimate rather than a fact.
- `src/lib/attention.ts` — the Needs Attention rules.
- `src/lib/kpi.ts` — every number on the executive dashboard.
- `src/lib/csv.ts` — Excel-safe CSV (UTF-8 BOM, formula-injection guarded).

`src/lib/activity.ts` is the write path. Every change to an opportunity goes through
`logActivity()`, which writes the timeline entry and derives — in the same transaction —
last activity, first response time, last contact, and whether an automated follow-up should
step aside because a human conversation started. Nothing writes those fields by hand.

Authorisation is in `src/lib/auth.ts`. `proxy.ts` only does a cheap signature check; every
page, route handler and Server Action calls `requireUser()` or `requireAdmin()` itself,
because a Server Action is a POST endpoint that can be called directly.

---

## Not built yet (Phase 2)

Follow-up state, cadence and the pause/resume controls are all in place and the schema is
ready; what is missing is the cron that actually sends.

1. Follow-up cron — send step N, respect `followupState`
2. Email intake — inbound enquiry becomes an opportunity (`lead_source` and `raw_intake`
   already shaped for it)
3. Mario's private daily Events Revenue Brief — reuses `attention.ts` and `kpi.ts`

GHL integration is deliberately out of scope; the records are structured cleanly enough to
connect it later without redesigning anything.
