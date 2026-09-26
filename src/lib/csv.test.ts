import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toCsv, escapeCell, csvFilename, UTF8_BOM,
  parseCsv, normalizeHeader, mapHeaders,
} from "./csv";

test("plain values pass through", () => {
  assert.equal(escapeCell("Acme"), "Acme");
  assert.equal(escapeCell(1200), "1200");
  assert.equal(escapeCell(null), "");
  assert.equal(escapeCell(undefined), "");
});

test("commas, quotes and newlines are quoted", () => {
  assert.equal(escapeCell("Smith, Jane"), '"Smith, Jane"');
  assert.equal(escapeCell('He said "hi"'), '"He said ""hi"""');
  assert.equal(escapeCell("line1\nline2"), '"line1\nline2"');
});

test("formula injection is neutralised", () => {
  // Excel would otherwise execute these on open.
  assert.equal(escapeCell("=1+1"), "'=1+1");
  assert.equal(escapeCell("+44 20 555"), "'+44 20 555");
  assert.equal(escapeCell("-500"), "'-500");
  assert.equal(escapeCell("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(escapeCell("=HYPERLINK(\"http://evil\")"), '"\'=HYPERLINK(""http://evil"")"');
});

test("output starts with a BOM so Excel reads UTF-8", () => {
  const csv = toCsv(["Name"], [["Zoë"]]);
  assert.ok(csv.startsWith(UTF8_BOM));
  assert.ok(csv.includes("Zoë"));
});

test("rows are CRLF separated with a header first", () => {
  const csv = toCsv(["A", "B"], [[1, 2], [3, 4]]);
  assert.equal(csv.slice(UTF8_BOM.length), "A,B\r\n1,2\r\n3,4");
});

test("an empty export still emits its header", () => {
  assert.equal(toCsv(["A", "B"], []).slice(UTF8_BOM.length), "A,B");
});

test("filenames carry the date", () => {
  assert.equal(csvFilename("emrg-opportunities", new Date("2026-09-21T10:00:00Z")),
    "emrg-opportunities-2026-09-21.csv");
});

// ── Reading ──────────────────────────────────────────────────────────────────

test("plain rows", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,2,3"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("a quoted field keeps its comma", () => {
  assert.deepEqual(parseCsv('code,"Smith, John",x'), [["code", "Smith, John", "x"]]);
});

test("a budget range survives intact", () => {
  const [row] = parseCsv('EMRG-1,"$50,000 to $75,000"');
  assert.equal(row[1], "$50,000 to $75,000");
});

test("escaped quotes collapse to one", () => {
  const [row] = parseCsv('a,"She said ""yes"" today"');
  assert.equal(row[1], 'She said "yes" today');
});

test("a newline inside quotes stays in the field", () => {
  const rows = parseCsv('a,"line one\nline two"\nb,c');
  assert.equal(rows.length, 2);
  assert.equal(rows[0][1], "line one\nline two");
  assert.deepEqual(rows[1], ["b", "c"]);
});

test("CRLF is one row break, not two", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d"), [["a", "b"], ["c", "d"]]);
});

test("a trailing newline does not invent an empty row", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
  assert.deepEqual(parseCsv("a,b\r\n"), [["a", "b"]]);
});

test("a byte-order mark is stripped from the first header", () => {
  const [row] = parseCsv("\uFEFFCode,Company");
  assert.equal(row[0], "Code");
});

test("empty fields are preserved, including trailing ones", () => {
  assert.deepEqual(parseCsv("a,,c,"), [["a", "", "c", ""]]);
});

test("a quoted empty field is still a field", () => {
  assert.deepEqual(parseCsv('a,"",c'), [["a", "", "c"]]);
});

test("an empty document yields no rows", () => {
  assert.deepEqual(parseCsv(""), []);
});

test("what this export writes, this reader reads back", () => {
  const headers = ["Company", "Contact", "Notes"];
  const rows = [["Acme, Inc.", 'He said "hi"', "line1\nline2"]];
  const parsed = parseCsv(toCsv(headers, rows));
  assert.deepEqual(parsed[0], headers);
  assert.deepEqual(parsed[1], rows[0]);
});

// ── Header mapping ───────────────────────────────────────────────────────────

const ALIASES = {
  code: ["proposal code", "code"],
  company: ["company"],
  email: ["email"],
  eventDates: ["event date", "event dates"],
};

test("headers match regardless of case, spacing and punctuation", () => {
  const { index, missing } = mapHeaders(["Proposal Code", "COMPANY", "E-Mail ", "Event Date(s)"], ALIASES);
  assert.deepEqual(missing, []);
  assert.equal(index.code, 0);
  assert.equal(index.company, 1);
  assert.equal(index.eventDates, 3);
});

test("an unrecognised column is reported rather than dropped", () => {
  const { unmatched } = mapHeaders(["Code", "Company", "Email", "Event Date", "Secret Sauce"], ALIASES);
  assert.deepEqual(unmatched, ["Secret Sauce"]);
});

test("a missing column is named", () => {
  const { missing } = mapHeaders(["Code", "Company"], ALIASES);
  assert.deepEqual(missing.sort(), ["email", "eventDates"]);
});

test("two fields never claim the same column", () => {
  const { index } = mapHeaders(["Event Date", "Event Dates"], {
    a: ["event date"], b: ["event dates"],
  });
  assert.notEqual(index.a, index.b);
});

test("blank trailing headers are not reported as unmatched", () => {
  const { unmatched } = mapHeaders(["Code", "Company", "Email", "Event Date", "", "  "], ALIASES);
  assert.deepEqual(unmatched, []);
});

test("normalizeHeader strips punctuation and case", () => {
  assert.equal(normalizeHeader(" Event_Date(s) "), "eventdates");
});
