// CSV generation for the export (brief §9).
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
