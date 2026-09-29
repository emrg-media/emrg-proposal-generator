// Pure date/duration helpers. Kept free of any database or Next.js import so
// client components can use them without pulling the Postgres driver into the
// browser bundle.

/** Milliseconds between the lead arriving and the first human response. */
export function speedToLeadMs(o: { leadReceivedAt: Date; firstResponseAt: Date | null }): number | null {
  if (!o.firstResponseAt) return null;
  return o.firstResponseAt.getTime() - o.leadReceivedAt.getTime();
}

/** "22m", "3h 05m", "2d 4h" — compact enough for a table cell. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${String(mins % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/**
 * EMRG is a New York business, so every timestamp is shown in New York time,
 * pinned explicitly rather than left to whatever machine is doing the render.
 *
 * Without this the server formats in its own zone and the browser formats in
 * the viewer's, so the same instant renders as 7:01 PM on the server and
 * 7:01 AM in the client. React treats that as a hydration mismatch, logs an
 * error and throws the tree away to re-render it. Pinning the zone makes both
 * sides agree, and means someone reading the pipeline from another country
 * still sees the times their colleagues see.
 */
export const DISPLAY_TIMEZONE = "America/New_York";

export function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function fmtDate(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric", timeZone: DISPLAY_TIMEZONE,
  });
}

/** yyyy-mm-dd, for <input type="date">. */
export function isoDate(v: Date | string | null | undefined): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Whole days elapsed since a timestamp. */
export function daysSince(v: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / 86_400_000);
}
