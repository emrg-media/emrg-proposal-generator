import type { Stage } from "@/db/schema";

// Colour is a scanning aid here, never the thing carrying the meaning: a stage
// box always contains the stage name, and an owner badge always sits beside the
// person's name. That is what makes the palettes below safe to use at these
// sizes, and it is why neither may ever be rendered without its label.

export interface Swatch { bg: string; fg: string; border: string; solid: string }

// ── Stages ───────────────────────────────────────────────────────────────────
//
// The seven open stages are given distinct hues so a column is recognisable
// before you read it. Won and Lost are deliberately NOT part of that set:
// they are outcomes, so green reads as good and Lost stays a quiet grey rather
// than competing for attention with live work.

export const STAGE_STYLES: Record<Stage, Swatch> = {
  new_lead:         { bg: "#eef2ff", fg: "#3730a3", border: "#c7d2fe", solid: "#4f46e5" },
  contacted:        { bg: "#e0f2fe", fg: "#075985", border: "#bae6fd", solid: "#0284c7" },
  proposal_needed:  { bg: "#fef3c7", fg: "#92400e", border: "#fde68a", solid: "#d97706" },
  proposal_review:  { bg: "#ffedd5", fg: "#9a3412", border: "#fed7aa", solid: "#ea580c" },
  proposal_sent:    { bg: "#f3e8ff", fg: "#6b21a8", border: "#e9d5ff", solid: "#9333ea" },
  client_reviewing: { bg: "#ccfbf1", fg: "#115e59", border: "#99f6e4", solid: "#0d9488" },
  contract_deposit: { bg: "#dcfce7", fg: "#166534", border: "#bbf7d0", solid: "#16a34a" },
  won:              { bg: "#16a34a", fg: "#ffffff", border: "#15803d", solid: "#15803d" },
  lost:             { bg: "#f5f5f4", fg: "#57534e", border: "#e7e5e4", solid: "#a8a29e" },
};

export function stageStyle(stage: string): Swatch {
  return STAGE_STYLES[stage as Stage] ?? STAGE_STYLES.new_lead;
}

// ── People ───────────────────────────────────────────────────────────────────
//
// Chosen by searching for a five-colour set that satisfies BOTH constraints at
// once, rather than picking hues and hoping:
//
//   · the data-viz palette validator on the all-pairs list, since any two
//     planners can end up side by side: worst normal-vision ΔE 19.6 (floor 15),
//     worst CVD ΔE 6.9;
//   · every fill reaching at least 4.9:1 against its own initials, so the
//     letters stay readable on the light yellow as well as the dark blue.
//
// A CVD ΔE in the 6-8 band is only permissible alongside a secondary encoding,
// which is why the owner's name is rendered next to every badge and the colour
// is never the sole carrier of who owns something.

export const OWNER_PALETTE = [
  "#2470cc", // blue
  "#eda100", // yellow
  "#008300", // green
  "#be185d", // magenta
  "#e87ba4", // pink
] as const;

/**
 * Colour by position in a stable ordering, NOT by hashing the id.
 *
 * Hashing five UUIDs into five slots collides more often than not, and two
 * planners sharing a colour defeats the entire point. Assigning by index
 * guarantees the first five people are all different, and the ordering is
 * fixed (oldest account first) so nobody's colour changes when someone joins.
 */
export function ownerColorAt(index: number): string {
  return OWNER_PALETTE[index % OWNER_PALETTE.length];
}

/** Build the whole team's assignment from an ordered list of user ids. */
export function buildOwnerColors(orderedUserIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  orderedUserIds.forEach((id, i) => { map[id] = ownerColorAt(i); });
  return map;
}

const INK_DARK = "#1c1917";
const INK_LIGHT = "#ffffff";

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Black or white on the given fill, whichever actually has more contrast.
 *
 * Computed rather than thresholded: a hand-picked luminance cut-off put white
 * on the palette's yellow at 2.2:1, which is unreadable. Comparing the two
 * candidates directly is correct for any colour added later.
 */
export function readableInk(hex: string): string {
  const bg = relativeLuminance(hex);
  const onDark = contrastRatio(bg, relativeLuminance(INK_DARK));
  const onLight = contrastRatio(bg, relativeLuminance(INK_LIGHT));
  return onDark >= onLight ? INK_DARK : INK_LIGHT;
}
