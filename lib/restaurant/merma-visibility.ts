// lib/restaurant/merma-visibility.ts
//
// What merma means in money on Menú › Ingredientes: the «Costo real (con
// merma)» next to the purchase price, and the «Impacto merma» of each recipe
// line in «Se usa en». No cost maths of its own: both go through
// effectiveLineCost, the function the recipe editor uses, so the numbers match
// the editor for the same date. Display only, no I/O.

import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import { convertUnitStr } from "@/lib/restaurant/units";

/** A price is usable only when it is a number above 0 (never shown as $0). */
export function usablePrice(price: number | null | undefined): price is number {
  return typeof price === "number" && Number.isFinite(price) && price > 0;
}

export type PanelCost =
  | { kind: "none" }
  | { kind: "real"; value: number; source: "own" | "buffer"; pct: number };

/** «Costo real (con merma)» per price unit: price ÷ (1 − merma) or the buffer. */
export function panelRealCost(i: {
  price: number | null;
  ownLossPct: number | null;
  bufferPct: number;
}): PanelCost {
  if (!usablePrice(i.price)) return { kind: "none" };
  const r = effectiveLineCost({
    amount: i.price,
    kind: "ingredient",
    ownYieldLossPct: i.ownLossPct,
    insideMeasuredPrep: false,
    bufferPct: i.bufferPct,
  });
  if (r.effective === null || r.pct === null) return { kind: "none" };
  return {
    kind: "real",
    value: r.effective,
    source: r.factor === "own_yield" ? "own" : "buffer",
    pct: r.pct,
  };
}

export type UseImpact =
  | { kind: "missing" } // no price: ⚑ Falta
  | { kind: "none" } // —
  | { kind: "extra"; amount: number };

export interface UseLine {
  qty: number | null;
  unit: string | null;
  /** The recipe is a preparation whose batch output is measured. */
  insideMeasuredPrep: boolean;
}

/**
 * Extra cost from merma on one recipe line (effective − raw). A line under a
 * measured preparation carries no factor, so it shows —, which also keeps a
 * factor from being counted twice. A line that only reaches the ingredient
 * through a preparation has no quantity of its own: —.
 */
export function impactOfUse(i: {
  price: number | null;
  priceUnit: string | null;
  ownLossPct: number | null;
  bufferPct: number;
  line: UseLine;
}): UseImpact {
  if (!usablePrice(i.price)) return { kind: "missing" };
  const { qty, unit } = i.line;
  if (qty === null || !(qty > 0)) return { kind: "none" };
  let inPriceUnit = qty;
  if (unit && i.priceUnit) {
    const c = convertUnitStr(qty, unit, i.priceUnit);
    if (!c.ok) return { kind: "none" };
    inPriceUnit = c.value;
  }
  const raw = i.price * inPriceUnit;
  const r = effectiveLineCost({
    amount: raw,
    kind: "ingredient",
    ownYieldLossPct: i.ownLossPct,
    insideMeasuredPrep: i.line.insideMeasuredPrep,
    bufferPct: i.bufferPct,
  });
  if (
    r.effective === null ||
    r.factor === "measured_prep" ||
    r.factor === "none"
  )
    return { kind: "none" };
  return { kind: "extra", amount: r.effective - raw };
}
