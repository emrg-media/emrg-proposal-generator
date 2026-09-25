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

// Each stage resolves through CSS variables rather than carrying hexes, so the
// same chip works in both themes without the component knowing which is active.
// The dark values were derived from these hues and checked against the dark
// card, not flipped automatically.
export const STAGE_STYLES: Record<Stage, Swatch> = {
  new_lead:          { bg: "var(--stage-new-lead-bg)", fg: "var(--stage-new-lead-fg)", border: "var(--stage-new-lead-line)", solid: "var(--stage-new-lead-solid)" },
  contacted:         { bg: "var(--stage-contacted-bg)", fg: "var(--stage-contacted-fg)", border: "var(--stage-contacted-line)", solid: "var(--stage-contacted-solid)" },
  proposal_needed:   { bg: "var(--stage-proposal-needed-bg)", fg: "var(--stage-proposal-needed-fg)", border: "var(--stage-proposal-needed-line)", solid: "var(--stage-proposal-needed-solid)" },
  proposal_review:   { bg: "var(--stage-proposal-review-bg)", fg: "var(--stage-proposal-review-fg)", border: "var(--stage-proposal-review-line)", solid: "var(--stage-proposal-review-solid)" },
  proposal_sent:     { bg: "var(--stage-proposal-sent-bg)", fg: "var(--stage-proposal-sent-fg)", border: "var(--stage-proposal-sent-line)", solid: "var(--stage-proposal-sent-solid)" },
  client_reviewing:  { bg: "var(--stage-client-reviewing-bg)", fg: "var(--stage-client-reviewing-fg)", border: "var(--stage-client-reviewing-line)", solid: "var(--stage-client-reviewing-solid)" },
  contract_deposit:  { bg: "var(--stage-contract-deposit-bg)", fg: "var(--stage-contract-deposit-fg)", border: "var(--stage-contract-deposit-line)", solid: "var(--stage-contract-deposit-solid)" },
  won:               { bg: "var(--stage-won-bg)", fg: "var(--stage-won-fg)", border: "var(--stage-won-line)", solid: "var(--stage-won-solid)" },
  lost:              { bg: "var(--stage-lost-bg)", fg: "var(--stage-lost-fg)", border: "var(--stage-lost-line)", solid: "var(--stage-lost-solid)" },
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
