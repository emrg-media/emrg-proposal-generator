// Runs once, before anything else in the app.
//
// EMRG is a New York company, but a Vercel function runs in UTC. Every date
// boundary in the reporting is computed with local-time arithmetic
// (setHours(0,0,0,0), new Date(year, month, 1)), so under UTC "Today" on the
// executive dashboard actually begins at 7pm ET the previous evening, and the
// daily brief's overnight window is shifted by the same five hours. A proposal
// sent at 11:30pm ET on 31 December lands in the following year's YTD.
//
// Vercel reserves the TZ environment variable, so it cannot be set in the
// project's environment. Node re-reads process.env.TZ when it is assigned, so
// setting it here fixes every boundary at once without threading a timezone
// through kpi.ts, brief.ts and every caller.
//
// Stored timestamps are unaffected: all 20 columns are `timestamptz`, so they
// are absolute instants and only their interpretation into days changes.

export const BUSINESS_TIMEZONE = "America/New_York";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.env.TZ = BUSINESS_TIMEZONE;
  }
}
