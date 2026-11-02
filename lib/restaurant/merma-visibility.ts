// lib/restaurant/merma-visibility.ts
//
// What merma means in money on Menú › Ingredientes: the «Costo real (con
// merma)» next to the purchase price, and the «Impacto merma» of each recipe
// line in «Se usa en». No cost maths of its own: both go through
// effectiveLineCost, the function the recipe editor uses, so the numbers match
// the editor for the same date. Display only, no I/O.

import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import {
  coveredByMeasuredPrep,
  factorForLine,
  type PrepNode,
} from "@/lib/restaurant/nested-yield";
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
  | { kind: "noConversion" } // the unit does not convert: ⚑ Falta conversión
  | { kind: "none" } // —
  | { kind: "unknown" } // — «vía preparación»: the share cannot be computed
  | { kind: "extra"; amount: number };

export interface UseLine {
  qty: number | null;
  unit: string | null;
  /** The recipe is a preparation covered by a measured yield (itself or above it). */
  insideMeasuredPrep: boolean;
}

/**
 * Extra cost from merma on one recipe line (effective − raw). A line under a
 * measured preparation carries no factor, so it shows —, which also keeps a
 * factor from being counted twice. A line with no quantity of its own is —.
 * A quantity whose unit does not convert to the price unit (or has no unit) is
 * «Falta conversión»: never guessed, never $0, and out of the totals.
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
  if (!unit || !i.priceUnit) return { kind: "noConversion" };
  const c = convertUnitStr(qty, unit, i.priceUnit);
  if (!c.ok) return { kind: "noConversion" };
  const raw = i.price * c.value;
  const r = factorForLine(
    {
      amount: raw,
      kind: "ingredient",
      ownYieldLossPct: i.ownLossPct,
    },
    i.line.insideMeasuredPrep,
    i.bufferPct
  );
  if (
    r.effective === null ||
    r.factor === "measured_prep" ||
    r.factor === "none"
  )
    return { kind: "none" };
  return { kind: "extra", amount: r.effective - raw };
}

/** The total of a column: only real extras; flagged lines are left out and counted. */
export function sumImpacts(impacts: readonly UseImpact[]): {
  total: number;
  counted: number;
  excluded: number;
} {
  let total = 0;
  let counted = 0;
  let excluded = 0;
  for (const i of impacts) {
    if (i.kind === "extra") {
      total += i.amount;
      counted += 1;
    } else if (i.kind === "missing" || i.kind === "noConversion") excluded += 1;
  }
  return { total, counted, excluded };
}

// ---------------------------------------------------------------------------
// Through a preparation
// ---------------------------------------------------------------------------

/** One line of a preparation's recipe, as the share needs it. */
export type PrepLine =
  | {
      kind: "ingredient";
      ingredientId: string;
      qty: number | null;
      unit: string | null;
    }
  | {
      kind: "component";
      componentId: string;
      qty: number | null;
      unit: string | null;
    };

export interface PrepDef {
  id: string;
  /** The batch output («rinde 6,5 kg»); null when the version has none. */
  outputQty: number | null;
  outputUnit: string | null;
  /** The output is measured (not the default 1 unit). */
  measured: boolean;
  lines: PrepLine[];
}

/** How much of a batch a quantity is: qty (in the output's unit) ÷ output. Null = cannot be computed. */
function batchShare(
  qty: number | null,
  unit: string | null,
  def: Pick<PrepDef, "outputQty" | "outputUnit">
): number | null {
  if (!qty || !(qty > 0) || !def.outputQty || !(def.outputQty > 0)) return null;
  if (!unit || !def.outputUnit) return null;
  const c = convertUnitStr(qty, unit, def.outputUnit);
  return c.ok ? c.value / def.outputQty : null;
}

/**
 * The merma impact of ONE ingredient over a whole batch of a preparation:
 * its own lines (under the same rule as everywhere: a measured preparation
 * above or at this level means no factor) plus, for each preparation line that
 * reaches it, that preparation's batch impact × the share of its batch used.
 */
function batchImpact(
  ingredientId: string,
  prepId: string,
  defs: ReadonlyMap<string, PrepDef>,
  ctx: {
    price: number | null;
    priceUnit: string | null;
    ownLossPct: number | null;
    bufferPct: number;
  },
  covered: ReadonlyMap<string, boolean>,
  seen: ReadonlySet<string>
): UseImpact {
  const def = defs.get(prepId);
  if (!def || seen.has(prepId)) return { kind: "unknown" };
  const next = new Set(seen).add(prepId);
  let total = 0;
  let any = false;
  for (const line of def.lines) {
    if (line.kind === "ingredient") {
      if (line.ingredientId !== ingredientId) continue;
      const r = impactOfUse({
        ...ctx,
        line: {
          qty: line.qty,
          unit: line.unit,
          insideMeasuredPrep: covered.get(prepId) === true,
        },
      });
      if (r.kind === "missing" || r.kind === "noConversion") return r;
      if (r.kind === "extra") {
        total += r.amount;
        any = true;
      }
    } else {
      const child = defs.get(line.componentId);
      if (!child) continue;
      if (!reaches(ingredientId, line.componentId, defs, new Set(next)))
        continue;
      const sub = batchImpact(
        ingredientId,
        line.componentId,
        defs,
        ctx,
        covered,
        next
      );
      if (sub.kind === "missing" || sub.kind === "noConversion") return sub;
      if (sub.kind === "unknown") return sub;
      if (sub.kind !== "extra") continue;
      const share = batchShare(line.qty, line.unit, child);
      if (share === null) return { kind: "unknown" };
      total += sub.amount * share;
      any = true;
    }
  }
  return any ? { kind: "extra", amount: total } : { kind: "none" };
}

function reaches(
  ingredientId: string,
  prepId: string,
  defs: ReadonlyMap<string, PrepDef>,
  seen: Set<string>
): boolean {
  if (seen.has(prepId)) return false;
  seen.add(prepId);
  const def = defs.get(prepId);
  if (!def) return false;
  return def.lines.some((l) =>
    l.kind === "ingredient"
      ? l.ingredientId === ingredientId
      : reaches(ingredientId, l.componentId, defs, seen)
  );
}

/**
 * «Impacto merma» of a plato (or preparation) that reaches the ingredient only
 * through preparations: the quantity of prep used ÷ the prep's batch output ×
 * the prep's merma impact for that ingredient, summed over the preparations it
 * uses. When any share cannot be computed the cell is — «vía preparación».
 */
export function impactViaPreps(
  ingredientId: string,
  via: ReadonlyArray<{
    componentId: string;
    qty: number | null;
    unit: string | null;
  }>,
  defs: ReadonlyMap<string, PrepDef>,
  ctx: {
    price: number | null;
    priceUnit: string | null;
    ownLossPct: number | null;
    bufferPct: number;
  },
  covered: ReadonlyMap<string, boolean>
): UseImpact {
  if (!usablePrice(ctx.price)) return { kind: "missing" };
  if (via.length === 0) return { kind: "unknown" };
  let total = 0;
  let any = false;
  for (const v of via) {
    const def = defs.get(v.componentId);
    if (!def) return { kind: "unknown" };
    const batch = batchImpact(
      ingredientId,
      v.componentId,
      defs,
      ctx,
      covered,
      new Set()
    );
    if (batch.kind === "missing" || batch.kind === "noConversion") return batch;
    if (batch.kind === "unknown") return batch;
    if (batch.kind !== "extra") continue;
    const share = batchShare(v.qty, v.unit, def);
    if (share === null) return { kind: "unknown" };
    total += batch.amount * share;
    any = true;
  }
  return any ? { kind: "extra", amount: total } : { kind: "none" };
}

/** For each preparation: it, or any preparation above it, has a measured output (#407). */
export function coveredMap(
  defs: ReadonlyMap<string, PrepDef>
): Map<string, boolean> {
  const nodes = new Map<string, PrepNode>(
    [...defs.values()].map((d) => [
      d.id,
      {
        id: d.id,
        measured: d.measured,
        children: d.lines.flatMap((l) =>
          l.kind === "component" ? [l.componentId] : []
        ),
      },
    ])
  );
  return new Map(
    [...defs.keys()].map((id) => [id, coveredByMeasuredPrep(id, nodes)])
  );
}

/**
 * What a role without price access may be sent: no price, no merma inputs.
 * Used by the Ingredientes page so the payload never carries money for cooks.
 */
export function redactMermaInputs<
  T extends {
    price: number | null;
    previous_price: number | null;
    price_unit: string | null;
    price_date: string | null;
    yieldPct?: number | null;
    yieldHistory?: unknown[];
  },
>(item: T, canViewPrices: boolean): T {
  if (canViewPrices) return item;
  return {
    ...item,
    price: null,
    previous_price: null,
    price_unit: null,
    price_date: null,
    yieldPct: null,
    yieldHistory: [],
  };
}
