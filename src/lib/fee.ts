// Resolving a quoted fee to a dollar figure.
//
// Fees arrive as free text: "$12,000", "20%", "18-22%", "$8k-12k". Every KPI in
// the system — pipeline value, won/lost totals, average deal size, stalled
// dollars — has to agree on what a given fee is worth, so this is the single
// place that decides. Lifted from the original dashboard implementation, whose
// behaviour the team already trusts: percentages resolve against the event
// budget, ranges resolve to their average, and anything averaged is flagged as
// an estimate pending confirmation rather than silently presented as fact.

export interface FeeCalc {
  /** Resolved dollar figure that counts toward totals; null when unknowable. */
  value: number | null;
  /** Derived from an average or a percentage — shown as "≈" and confirmable. */
  estimated: boolean;
  /** A percentage fee with no budget on file to apply it to. */
  needsBudget: boolean;
  /** Plain-language explanation for the tooltip. */
  basis: string;
}

/** Pull every dollar amount out of free text, honouring a "k" suffix. */
export function moneyValues(text: string): number[] {
  return [...text.matchAll(/\$?\s*([\d][\d,]*(?:\.\d+)?)\s*([kK])?/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1))
    .filter((n) => !isNaN(n) && n > 0);
}

export function average(nums: number[]): number | null {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export function fmtMoney(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export function computeFee(fee: string, budget: string): FeeCalc {
  const f = (fee || "").trim();
  if (!f) return { value: null, estimated: false, needsBudget: false, basis: "No fee entered yet." };

  // Percentage fee → always convert to dollars using the event budget.
  // A range like "18-22%" has only the last number touching the %, so pull
  // every number in the fee string (capped at 100) as the percent bound(s).
  if (f.includes("%")) {
    const pctNums = [...f.matchAll(/([\d.]+)/g)]
      .map((m) => parseFloat(m[1]))
      .filter((n) => n > 0 && n <= 100);
    if (pctNums.length === 0) {
      return { value: null, estimated: false, needsBudget: false, basis: "This fee could not be read as a number." };
    }
    const pct = average(pctNums)!;
    const budgets = moneyValues(budget || "");
    if (budgets.length === 0) {
      return {
        value: null, estimated: true, needsBudget: true,
        basis: `This is a ${f} fee, but there is no event budget on file to calculate it from.`,
      };
    }
    // pct of each budget bound, averaged (identical to pct of the average budget)
    const value = Math.round((pct / 100) * average(budgets)!);
    const basis = budgets.length > 1
      ? `${pct}% of the low budget (${fmtMoney((pct / 100) * budgets[0])}) and the high budget (${fmtMoney((pct / 100) * budgets[budgets.length - 1])}), averaged.`
      : `${pct}% of the ${fmtMoney(budgets[0])} budget.`;
    return { value, estimated: true, needsBudget: false, basis };
  }

  // Dollar fee(s).
  const amounts = moneyValues(f);
  if (amounts.length === 0) {
    return { value: null, estimated: false, needsBudget: false, basis: "This fee could not be read as a number." };
  }
  if (amounts.length === 1) {
    return { value: Math.round(amounts[0]), estimated: false, needsBudget: false, basis: "" };
  }
  return { value: Math.round(average(amounts)!), estimated: true, needsBudget: false, basis: "The average of the quoted fee range." };
}

/** Short label for a board card or table cell. */
export function feeLabel(fc: FeeCalc, rawFee: string): string {
  if (fc.needsBudget) return "Fee TBD";
  if (fc.value === null) return rawFee || "No fee";
  return (fc.estimated ? "≈ " : "") + fmtMoney(fc.value);
}

// ── Cents helpers (the DB stores integer cents, the UI speaks dollars) ───────

export function toCents(dollars: number | null): number | null {
  return dollars === null ? null : Math.round(dollars * 100);
}

export function fromCents(cents: number | null | undefined): number | null {
  return cents === null || cents === undefined ? null : cents / 100;
}

export function fmtCents(cents: number | null | undefined): string {
  const d = fromCents(cents);
  return d === null ? "" : fmtMoney(d);
}

/** Parse a single free-text money field (a budget bound) into cents. */
export function parseMoneyToCents(text: string): number | null {
  const vals = moneyValues(text || "");
  return vals.length ? Math.round(vals[0] * 100) : null;
}

/**
 * Resolve an opportunity's stored budget bounds back into the free-text shape
 * computeFee expects, so percentage fees can be applied.
 */
export function budgetText(lowCents: number | null, highCents: number | null): string {
  const parts = [lowCents, highCents]
    .filter((c): c is number => c !== null && c !== undefined)
    .map((c) => fmtMoney(c / 100));
  return parts.join(" to ");
}
