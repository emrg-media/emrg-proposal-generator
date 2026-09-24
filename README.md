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
| `/proposal` | Everyone | **The front door.** Fill in the proposal; the opportunity is created for you |
| `/new` | Everyone | Log a lead you are not quoting yet |
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
| `INTAKE_SECRET` | Bearer token for `POST /api/intake/email`. Without it the endpoint refuses every machine request. |
| `CRON_SECRET` | Required for the cron endpoints. Without it they refuse every request. |
| `APP_URL` | Where the brief links back to. Falls back to the production domain, then the deployment. |
| `BRIEF_RECIPIENTS` | Comma-separated override for who gets the daily brief. Defaults to active admins. |
| `FOLLOWUPS_ENABLED` | Set to `true` to let the system email clients. Anything else and it only ever previews. |

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

## Connecting a mailbox

Two routes, and the first needs no Google admin.

### Forwarding, via Resend (works today)

1. Accept the Resend marketplace terms, then `vercel integration add resend`.
2. In Resend, add a receiving address and point a webhook at
   `POST https://<the app>/api/intake/resend`, subscribed to `email.received`.
3. Put the webhook signing secret in `RESEND_WEBHOOK_SECRET` and the API key in
   `RESEND_API_KEY`.
4. In Gmail, Settings → Forwarding, add that receiving address, verify it, then add a
   filter forwarding whatever should become leads.

Roughly fifteen minutes, entirely in Gmail's own settings.

Resend's webhook deliberately carries metadata only, so the handler fetches the body
through the receiving API afterwards. That fetch also returns SPF, DKIM and DMARC
results computed by the receiving server rather than read from the message, so a
sender cannot forge them; anything that hard-fails SPF or DMARC is dropped rather
than filed. Signatures are verified against the raw body before it is parsed.

### Gmail API (the long-term one)

Domain-wide delegation, approved once by the Workspace admin, covering the shared
inboxes and pushing in real time. Whatever watches the mailbox just posts to
`/api/intake/email`; nothing else changes.

## Inbound email

`POST /api/intake/email` turns a message into an opportunity. Everything is built
except the connection to a mailbox, so wiring Gmail up later is configuration rather
than another feature. The same pipeline runs behind "Forwarded email" on `/new`, so
what the team does by hand today is exactly what automation will do.

```json
{ "fromEmail": "priya@northwind.com", "fromName": "Priya Raman",
  "subject": "Awards gala", "body": "...", "receivedAt": "2027-03-03T09:14:00Z" }
```

Authenticated with `INTAKE_SECRET` as a Bearer token, or a signed-in session. Fails
closed when the secret is unset, and sits outside the session gate in `proxy.ts`
because its caller is a machine.

What it handles:

- **Junk never becomes a lead.** Out-of-office, bounces, no-reply senders and bulk
  mail are rejected on headers and shape; anything that gets past that is classified,
  so a recruiter pitch or an invoice is ignored rather than filed as an enquiry.
- **A reply lands on the existing deal**, not a duplicate. That is what pauses the
  follow-up sequence and moves the opportunity into "client waiting on us".
- **A forwarded enquiry is credited to the client**, not the colleague who forwarded it.
- **The clock starts when the mail arrived**, not when the system got to it, so
  speed-to-lead stays honest.
- **Routing decides the owner** with no human present, which is the case the rules exist for.
- **Signatures are kept deliberately.** They are usually the only place the company
  name and job title appear.

## Who gets the lead

Routing is decided in `lib/routing.ts`, a pure function, and configured under
`/admin`. Rules are read top to bottom and the first match wins:

1. **An existing client stays with the planner who knows them.** Matched on contact
   email first, then company name. Whoever entered the lead is added as a collaborator
   rather than dropped. This can be switched off.
2. **The team's own rules**, matching on event type, lead source or deal value.
3. **Whoever is doing the work**, because a planner filling in a proposal is not looking
   to hand it to someone else.
4. **Nobody driving?** Either a named default owner, or whoever is carrying the fewest
   open opportunities. Ties break deterministically.

Every automatic assignment writes its reason to the timeline. Silent routing is the
fastest way to make a team stop trusting it.

Step 4 is the one that matters for email intake, where no human is present to own the
lead by default.

## Mario's daily brief

One email each weekday at 7am ET (`vercel.json`), to admins only and never copied to
the shared inbox. `/admin` shows exactly what tomorrow's will say with today's numbers.

Ordered by what he can act on:

1. **Needs you** — approvals, and anything nobody owns. The only things he personally unblocks.
2. **Right now** — open pipeline, stalled money, leads past target. Unaffected by any date filter.
3. **Yesterday** (or *since Friday* on a Monday, so a weekend is never skipped) — what moved.
4. **Needs attention** — the rest, capped so the email stays scannable.

A quiet day is three lines. Zero rows are omitted rather than printed as zeroes, and the
subject says the state without needing the body opened: *"EMRG brief: 2 need you"*.

Built from `kpi.ts` and `attention.ts`, the same modules the screens read, so the brief
and the dashboard cannot tell different stories. Recipients default to active admins;
`BRIEF_RECIPIENTS` overrides with a comma-separated list.

## Follow-ups

Built and tested, and **off until you turn it on**. This is the only part of the system that
emails clients by itself, so:

- It does nothing unless `FOLLOWUPS_ENABLED=true`.
- It never touches a paused, stopped, won or lost deal, or one with no proposal sent.
- It claims each step *before* sending, so a crash mid-run costs a client one fewer email
  rather than one too many.
- `/admin` shows the queue with the exact wording that would go out. Read it before
  enabling.

Runs weekdays at 10am ET (`vercel.json`). Cadence is configurable in `/admin`, default
1 / 3 / 7 days after the proposal is sent.

## Not built yet

1. The Gmail connection itself: watching the inboxes and posting each new message to
   the intake endpoint. Needs Workspace access, which is the long pole. The Resend
   forwarding route above works without it.
2. Putting the client email into the salesperson's Gmail drafts instead of sending it,
   which waits on the decision between sending and drafting.


## Sample data

`npm run db:demo` loads nine realistic opportunities and the app shows a banner saying so.
`npm run db:demo -- wipe` removes them, and the banner disappears with them. Anything
created by hand is untouched either way.

GHL integration is deliberately out of scope; the records are structured cleanly enough to
connect it later without redesigning anything.
