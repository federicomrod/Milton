// Live cost and margin of a Telegram recipe draft (Revisar receta and the
// Cocina card). Pure and client-safe: it is recomputed every time a quantity,
// unit, ingredient, price or the portions change.
//
// Rules (the same as the rest of Milton):
//  - the price of an ingredient is its CURRENT price (the caller builds the map
//    with the shared `latestCostEntry`); an ingredient without one is «Sin
//    precio», never $0;
//  - a total is only presented as complete when EVERY line is priced;
//    otherwise it is «Costo parcial · faltan precios de A, B»;
//  - the margin needs a complete cost and a selling price above 0.
// A draft never counts in Costos or margins; this is only an estimate for the
// person reviewing it.

import { convertUnitStr, normalizeUnit } from "@/lib/restaurant/units";

export interface PriceInfo {
  /** Price per ONE `unit` (normalized). */
  unit_cost: number;
  unit: string;
}

export interface CostLineInput {
  key: string;
  ingredient_id: string | null;
  /** Name to show when the line has no price. */
  name: string | null;
  total_quantity: number | null;
  unit: string | null;
}

export type CostLineReason =
  | "ok"
  | "no_ingredient"
  | "no_price"
  | "no_quantity"
  | "unit";

export interface CostLine {
  key: string;
  reason: CostLineReason;
  /** The ingredient's current price, when it has one. */
  price: PriceInfo | null;
  /** Cost of this line for the whole batch; null = cannot be costed yet. */
  line_cost: number | null;
}

export interface DraftCost {
  lines: CostLine[];
  /** Every line is costed (and there is at least one). */
  complete: boolean;
  /** Whole batch; only when complete. */
  total: number | null;
  /** Per portion; only when complete and portions are known. */
  per_portion: number | null;
  /** Names of the ingredients that block a complete cost, in line order. */
  missing: string[];
  /** Lines that only lack a price (for «Faltan precios: N»). */
  unpriced_count: number;
  /** (price − cost) / price, only with a complete cost and a price above 0. */
  margin_pct: number | null;
}

export function computeDraftCost(
  lines: readonly CostLineInput[],
  prices: ReadonlyMap<string, PriceInfo | null>,
  portions: number | null,
  sellingPrice: number | null
): DraftCost {
  const out: CostLine[] = [];
  const missing: string[] = [];
  let unpriced = 0;
  const miss = (label: string | null) => {
    const text = (label ?? "").trim() || "un ingrediente";
    if (!missing.includes(text)) missing.push(text);
  };

  for (const line of lines) {
    if (!line.ingredient_id) {
      out.push({
        key: line.key,
        reason: "no_ingredient",
        price: null,
        line_cost: null,
      });
      miss(line.name);
      continue;
    }
    const price = prices.get(line.ingredient_id) ?? null;
    if (!price) {
      out.push({
        key: line.key,
        reason: "no_price",
        price: null,
        line_cost: null,
      });
      unpriced += 1;
      miss(line.name);
      continue;
    }
    if (
      line.total_quantity === null ||
      !Number.isFinite(line.total_quantity) ||
      line.total_quantity <= 0
    ) {
      out.push({
        key: line.key,
        reason: "no_quantity",
        price,
        line_cost: null,
      });
      miss(line.name);
      continue;
    }
    if (!line.unit || !normalizeUnit(line.unit)) {
      out.push({ key: line.key, reason: "unit", price, line_cost: null });
      miss(line.name);
      continue;
    }
    const converted = convertUnitStr(
      line.total_quantity,
      line.unit,
      price.unit
    );
    if (!converted.ok) {
      out.push({ key: line.key, reason: "unit", price, line_cost: null });
      miss(line.name);
      continue;
    }
    out.push({
      key: line.key,
      reason: "ok",
      price,
      line_cost: converted.value * price.unit_cost,
    });
  }

  const complete = lines.length > 0 && out.every((l) => l.line_cost !== null);
  const total = complete
    ? out.reduce((sum, l) => sum + (l.line_cost ?? 0), 0)
    : null;
  const perPortion =
    total !== null && portions && portions > 0 ? total / portions : null;
  const margin =
    perPortion !== null && sellingPrice !== null && sellingPrice > 0
      ? ((sellingPrice - perPortion) / sellingPrice) * 100
      : null;
  return {
    lines: out,
    complete,
    total,
    per_portion: perPortion,
    missing,
    unpriced_count: unpriced,
    margin_pct: margin,
  };
}
