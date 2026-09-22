import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, escapeCell, csvFilename, UTF8_BOM } from "./csv";

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
