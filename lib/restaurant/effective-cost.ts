// lib/restaurant/effective-cost.ts
//
// ONE loss factor per ingredient line, the first that applies (#405 rules,
// shown in the recipe editor by #406):
//   1. the ingredient's own yield:           cost ÷ (1 − loss)
//   2. a measured preparation above it:      none (the batch output already is the yield)
//   3. otherwise the restaurant's buffer:    cost × (1 + buffer)
// Preparations never get a buffer and a line with its own cost (from the
// file) is not changed. Full precision here; the caller rounds only a total.
// Pure, no I/O.

export type CostFactor =
  | "own_yield"
  | "measured_prep"
  | "kitchen_buffer"
  | "none";

export interface LineFactorInput {
  /** The raw cost of the line (price × quantity); null = no price. */
  amount: number | null;
  kind: "ingredient" | "component" | "unresolved";
  /** The line carries its own cost from the file. */
  ownCost?: boolean;
  /** The ingredient's approved yield loss in force, in %; null = none. */
  ownYieldLossPct: number | null;
  /** The line sits inside a preparation with a measured (confirmed) output. */
  insideMeasuredPrep: boolean;
  /** The restaurant's buffer in force, in %. */
  bufferPct: number;
}

export interface LineEffective {
  /** Effective cost at full precision; null when the raw cost is missing. */
  effective: number | null;
  factor: CostFactor;
  /** The % behind the factor (loss or buffer); null for «none» / measured prep. */
  pct: number | null;
}

export function effectiveLineCost(i: LineFactorInput): LineEffective {
  if (i.amount === null || !Number.isFinite(i.amount))
    return { effective: null, factor: "none", pct: null };
  if (i.kind !== "ingredient" || i.ownCost)
    return { effective: i.amount, factor: "none", pct: null };
  if (i.ownYieldLossPct !== null) {
    const loss = i.ownYieldLossPct / 100;
    if (loss >= 0 && loss < 1)
      return {
        effective: i.amount / (1 - loss),
        factor: "own_yield",
        pct: i.ownYieldLossPct,
      };
  }
  if (i.insideMeasuredPrep)
    return { effective: i.amount, factor: "measured_prep", pct: null };
  return {
    effective: i.amount * (1 + i.bufferPct / 100),
    factor: "kitchen_buffer",
    pct: i.bufferPct,
  };
}
