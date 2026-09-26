// CSV, both directions: generating the export (brief §9), and reading a
// downloaded tracker back in so the migration needs no Google credentials.
//
// Two things matter beyond joining commas:
//  1. Excel only reads UTF-8 correctly when the file starts with a BOM, so
//     accented names and the £/€ signs survive the round trip.
//  2. A cell beginning = + - or @ is executed as a formula by Excel and
//     Sheets. Prefixing with a single quote neutralises it — the same guard
//     the existing Sheets logger uses.

export const UTF8_BOM = "﻿";

export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  // CRLF keeps Excel happy on Windows and is harmless elsewhere.
  return UTF8_BOM + lines.join("\r\n");
}

export function csvFilename(prefix: string, now: Date = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `${prefix}-${d}.csv`;
}

// ── Reading ──────────────────────────────────────────────────────────────────
//
// Hand-rolled rather than pulled from npm: the whole job is 40 lines, and a
// split(",") would quietly corrupt the very fields the import cares about.
// "Smith, John" and "$50,000 to $75,000" both contain commas, and notes
// contain line breaks.

/** Parse CSV text into rows. Handles quotes, escaped quotes, commas and
 *  newlines inside fields, CRLF, and a leading byte-order mark. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  while (i < s.length) {
    const c = s[i];

    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }  // "" is a literal quote
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { quoted = true; i++; continue; }
    if (c === ",") { endField(); i++; continue; }
    if (c === "\r" && s[i + 1] === "\n") { endRow(); i += 2; continue; }
    if (c === "\n" || c === "\r") { endRow(); i++; continue; }
    field += c; i++;
  }

  // A trailing newline should not invent a final empty record.
  if (field !== "" || row.length > 0 || quoted) endRow();

  return rows;
}

/** Lowercase and strip anything that is not a letter or digit, so
 *  "Event Date(s)", "event_dates" and "EVENT DATES" all compare equal. */
export function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Map a header row to column indexes by name.
 *
 * Returns the index per field plus the headers nothing claimed, so an
 * unrecognised column is reported rather than silently dropped, which is
 * exactly the bug a fixed-position reader has.
 */
export function mapHeaders(
  headerRow: string[],
  aliases: Record<string, string[]>,
): { index: Record<string, number>; unmatched: string[]; missing: string[] } {
  const norm = headerRow.map(normalizeHeader);
  const index: Record<string, number> = {};
  const claimed = new Set<number>();

  for (const [field, names] of Object.entries(aliases)) {
    const wanted = names.map(normalizeHeader);
    // Exact match first, then prefix, so "eventdate" does not lose to
    // "eventdatenotes" just because that column happens to come first.
    let at = norm.findIndex((h, j) => !claimed.has(j) && wanted.includes(h));
    if (at === -1) {
      at = norm.findIndex((h, j) => !claimed.has(j) && wanted.some((w) => h.startsWith(w)));
    }
    if (at !== -1) { index[field] = at; claimed.add(at); }
  }

  const unmatched = headerRow
    .map((h, j) => (claimed.has(j) || !h.trim() ? null : h))
    .filter((h): h is string => h !== null);
  const missing = Object.keys(aliases).filter((f) => !(f in index));

  return { index, unmatched, missing };
}
