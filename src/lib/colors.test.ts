import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOwnerColors, ownerColorAt, readableInk, stageStyle, OWNER_PALETTE, STAGE_STYLES } from "./colors";
import { STAGES } from "./constants";

// The whole point of owner colour is telling two planners apart at a glance.
// An earlier version hashed the user id into the palette, and Amanda and Mary
// Jane came out the same pink. These pin the fix.

test("the whole team gets distinct colours", () => {
  const team = ["erica", "victoria", "amanda", "maryjane", "mario"];
  const colors = buildOwnerColors(team);
  assert.equal(new Set(Object.values(colors)).size, team.length);
});

test("any five consecutive people are all different", () => {
  const ids = Array.from({ length: 5 }, (_, i) => `user-${i}`);
  const colors = Object.values(buildOwnerColors(ids));
  assert.equal(new Set(colors).size, 5);
});

test("a person's colour does not change when someone else joins", () => {
  const before = buildOwnerColors(["a", "b", "c"]);
  const after = buildOwnerColors(["a", "b", "c", "d"]);
  for (const id of ["a", "b", "c"]) assert.equal(after[id], before[id]);
});

test("a sixth person wraps rather than inventing a hue", () => {
  const colors = buildOwnerColors(["a", "b", "c", "d", "e", "f"]);
  assert.equal(colors.f, colors.a, "wraps to the start of the fixed order");
  assert.ok(OWNER_PALETTE.includes(colors.f as typeof OWNER_PALETTE[number]));
});

test("initials stay legible on every palette colour", () => {
  // The palette spans a dark violet and a light yellow, so a single fixed ink
  // colour would be unreadable at one end.
  for (const hex of OWNER_PALETTE) {
    const ink = readableInk(hex);
    assert.ok(ink === "#ffffff" || ink === "#1c1917", `unexpected ink for ${hex}`);
  }
  assert.equal(readableInk("#eda100"), "#1c1917", "dark ink on the light yellow");
  assert.equal(readableInk("#4a3aa7"), "#ffffff", "white ink on the dark violet");
});

test("every stage has its own colour", () => {
  const solids = STAGES.map((s) => STAGE_STYLES[s].solid);
  assert.equal(new Set(solids).size, STAGES.length, "no two stages share a colour");
});

test("an unknown stage falls back instead of throwing", () => {
  assert.deepEqual(stageStyle("not_a_real_stage"), STAGE_STYLES.new_lead);
});

test("colour assignment is by position, never by id content", () => {
  // Two very different id strings in the same position get the same colour,
  // which is what makes the assignment predictable.
  assert.equal(buildOwnerColors(["zzz"])["zzz"], buildOwnerColors(["aaa"])["aaa"]);
  assert.equal(ownerColorAt(0), OWNER_PALETTE[0]);
});

test("the chosen ink always clears 4.5:1 on its badge", () => {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const hex of OWNER_PALETTE) {
    const r = ratio(hex, readableInk(hex));
    assert.ok(r >= 4.5, `${hex} with ${readableInk(hex)} is only ${r.toFixed(2)}:1`);
  }
});
