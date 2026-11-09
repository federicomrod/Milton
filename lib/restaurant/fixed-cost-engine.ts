// lib/restaurant/fixed-cost-engine.ts
//
// THE one place that turns confirmed fixed costs into figures: the total, the
// break-even, whether it is complete, and exactly what is missing. Costos fijos,
// Rentabilidad, the mobile views and the live preview in the form all call this
// function. There is no second copy of the arithmetic anywhere.
//
// It is pure: no I/O, no clock. It only reads what it is given, so it can run on
// the server (authoritative) and in the browser (a preview of the same function).
//
// The approved formula is unchanged (see lib/restaurant/fixed-costs.ts):
//   breakEven/day = Σ confirmed amounts ÷ (Margen bruto % × días que abres)
//   Margen bruto % = (Ventas − Impuestos − Comida y bebida − Merma) ÷ Ventas
//   Impuestos = Ventas × tasa ÷ (1 + tasa), subtracted once, never added to costs.
//
// RESULT CONTRACT
//   status "complete"    all four amount categories have a figure (a confirmed
//                        0 is a figure) and every other input is usable.
//   status "partial"     a number exists for the categories that ARE known, but
//                        something is missing; `missing` says exactly what.
//   status "unavailable" no usable number: `breakEven` is null and `missing`
//                        says why. Never a guess, never a divide by zero.
//   A missing category is never 0. A missing tax rate is NOT guessed: the
//   existing formula calculates it as 0 %, so the result is "partial" and the
//   `missing` list says the tax rate is not set (see docs/design).

import {
  AMOUNT_CATEGORIES,
  contributionMarginPct,
  type AmountCategory,
  type EffectiveFixedCosts,
  type FixedCostCategory,
  type MarginInputs,
} from "@/lib/restaurant/fixed-costs";

export type MissingInput =
  | { kind: "category"; category: AmountCategory }
  | { kind: "tax" }
  | { kind: "margin"; reason: "no_sales" | "not_positive" | "not_loaded" }
  | { kind: "open_days" };

export type FigureStatus = "complete" | "partial" | "unavailable";

export type TaxSource =
  | { kind: "local"; month: string; rate: number }
  | { kind: "group"; month: string; rate: number }
  | { kind: "missing" };

export interface FixedFigures {
  status: FigureStatus;
  /** Σ of the known amount categories; null when none is known (never 0). */
  total: number | null;
  known: AmountCategory[];
  /** Everything that keeps the result from being complete. */
  missing: MissingInput[];
  /** null when status is "unavailable". */
  breakEven: number | null;
  /** Categories with a figure (own or from the group), tax included. */
  confirmed: number;
  /** Applicable categories: the four amounts and the tax rate. */
  totalCategories: number;
  tax: TaxSource;
  /** Inputs the number was computed from (for "as of" labels). */
  basis: { openDays: number; marginMonth: string | null };
}

export interface FigureInputs {
  month: string;
  costs: EffectiveFixedCosts;
  /** Where the tax rate came from. Built by the caller that knows the scope. */
  taxSource: "local" | "group" | null;
  margin: MarginInputs | null;
  /** Month the margin was read from; differs from `month` when it fell back. */
  marginMonth?: string | null;
  openDays: number;
}

export function computeFixedFigures(input: FigureInputs): FixedFigures {
  const { costs } = input;
  const known = AMOUNT_CATEGORIES.filter((c) => costs.amounts[c] !== null);
  const missing: MissingInput[] = AMOUNT_CATEGORIES.filter(
    (c) => costs.amounts[c] === null
  ).map((category) => ({ kind: "category" as const, category }));
  const total =
    known.length > 0
      ? Math.round(
          known.reduce((s, c) => s + (costs.amounts[c] as number), 0) * 100
        ) / 100
      : null;

  const rate = costs.impuestosPct;
  const tax: TaxSource =
    rate === null || input.taxSource === null
      ? { kind: "missing" }
      : { kind: input.taxSource, month: input.month, rate };
  if (tax.kind === "missing") missing.push({ kind: "tax" });

  const cm = input.margin ? contributionMarginPct(input.margin, rate) : null;
  let marginProblem: MissingInput | null = null;
  if (!input.margin) marginProblem = { kind: "margin", reason: "no_sales" };
  else if (cm === null || cm <= 0)
    marginProblem = { kind: "margin", reason: "not_positive" };
  if (marginProblem) missing.push(marginProblem);
  if (!(input.openDays > 0)) missing.push({ kind: "open_days" });

  const computable =
    total !== null && !marginProblem && input.openDays > 0 && cm !== null;
  const breakEven = computable ? total / (cm * input.openDays) : null;

  const status: FigureStatus =
    breakEven === null
      ? "unavailable"
      : missing.length === 0
        ? "complete"
        : "partial";

  return {
    status,
    total,
    known,
    missing,
    breakEven: breakEven === null ? null : Math.round(breakEven * 100) / 100,
    confirmed: known.length + (tax.kind === "missing" ? 0 : 1),
    totalCategories: AMOUNT_CATEGORIES.length + 1,
    tax,
    basis: { openDays: input.openDays, marginMonth: input.marginMonth ?? null },
  };
}

/** The names of the categories still missing, in display order. */
export function missingCategories(f: FixedFigures): FixedCostCategory[] {
  const out: FixedCostCategory[] = [];
  for (const m of f.missing) {
    if (m.kind === "category") out.push(m.category);
    if (m.kind === "tax") out.push("impuestos");
  }
  return out;
}
