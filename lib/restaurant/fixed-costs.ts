// lib/restaurant/fixed-costs.ts
//
// Rentabilidad + Costos fijos, Fase 1a (#397). Pure helpers — no React, no
// Supabase — so the rules are unit-testable: line validation, the monthly
// repeat plan, the group split (largest remainder), completeness (the ⚑ Falta
// flag) and the break-even. A missing value is `null`, never 0; a typed 0 is a
// real value.

export const AMOUNT_CATEGORIES = [
  "planilla",
  "alquiler",
  "servicios",
  "otros",
] as const;
export type AmountCategory = (typeof AMOUNT_CATEGORIES)[number];

export const FIXED_COST_CATEGORIES = [
  ...AMOUNT_CATEGORIES,
  "impuestos",
] as const;
export type FixedCostCategory = (typeof FIXED_COST_CATEGORIES)[number];

export const CATEGORY_LABELS_ES: Record<FixedCostCategory, string> = {
  planilla: "Planilla",
  alquiler: "Alquiler",
  servicios: "Servicios",
  otros: "Otros",
  impuestos: "Impuestos",
};

export type FixedCostSource = "manual" | "repeat" | "estimate" | "upload";
export type FixedCostStatus = "draft" | "confirmed";
export type SplitRule = "sales" | "equal";

export interface FixedCostLine {
  id?: string;
  /** null = shared by the whole group. */
  location_id: string | null;
  /** First day of the month, YYYY-MM-01. */
  month: string;
  category: FixedCostCategory;
  label: string | null;
  /** Amount categories only; null for impuestos. */
  amount: number | null;
  /** impuestos only (0–100); null for the amount categories. */
  pct_of_sales: number | null;
  currency: string;
  source: FixedCostSource;
  status: FixedCostStatus;
  repeats: boolean;
  split_rule: SplitRule | null;
}

export function isFixedCostCategory(v: unknown): v is FixedCostCategory {
  return (FIXED_COST_CATEGORIES as readonly string[]).includes(v as string);
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])(?:-\d{2})?$/;

/** «2026-03», «2026-03-17» or a Date → «2026-03-01»; null when invalid. */
export function monthStartOf(input: string | Date): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }
  const m = MONTH_RE.exec(input.trim());
  return m ? `${m[1]}-${m[2]}-01` : null;
}

export function nextMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

export function previousMonthStart(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1
    ? `${y - 1}-12-01`
    : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface LineInput {
  location_id?: unknown;
  month?: unknown;
  category?: unknown;
  label?: unknown;
  /** The typed value: amount for the four amount categories, % for impuestos. */
  value?: unknown;
  repeats?: unknown;
  split_rule?: unknown;
}

export type LineValidation =
  | {
      ok: true;
      value: Pick<
        FixedCostLine,
        | "location_id"
        | "month"
        | "category"
        | "label"
        | "amount"
        | "pct_of_sales"
        | "repeats"
        | "split_rule"
      >;
    }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns one typed field into the row to store. An impuestos line keeps the
 * value as a % and no amount; every other category keeps an amount and no %.
 * `value` null/""/undefined is NOT valid here: an empty field is no row (the
 * caller deletes it), never a stored 0.
 */
export function validateLine(input: LineInput): LineValidation {
  if (!isFixedCostCategory(input.category))
    return { ok: false, error: "Categoría no válida." };
  const month =
    typeof input.month === "string" ? monthStartOf(input.month) : null;
  if (!month) return { ok: false, error: "Mes no válido." };
  let location_id: string | null = null;
  if (input.location_id !== null && input.location_id !== undefined) {
    if (typeof input.location_id !== "string" || !UUID.test(input.location_id))
      return { ok: false, error: "Restaurante no válido." };
    location_id = input.location_id;
  }
  const raw = input.value;
  if (raw === null || raw === undefined || raw === "")
    return { ok: false, error: "Falta el valor." };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0)
    return { ok: false, error: "El valor debe ser 0 o más." };
  const isTax = input.category === "impuestos";
  if (isTax && n > 100)
    return { ok: false, error: "El porcentaje va de 0 a 100." };
  const split =
    input.split_rule === "sales" || input.split_rule === "equal"
      ? input.split_rule
      : null;
  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim().slice(0, 120)
      : null;
  return {
    ok: true,
    value: {
      location_id,
      month,
      category: input.category,
      label,
      amount: isTax ? null : Math.round(n * 100) / 100,
      pct_of_sales: isTax ? Math.round(n * 100) / 100 : null,
      repeats: input.repeats === true,
      // Only a group line is split.
      split_rule: location_id === null ? (split ?? "sales") : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Repeat
// ---------------------------------------------------------------------------

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** One line per category in each scope (restaurant or group) and month. */
export function lineKey(
  l: Pick<FixedCostLine, "location_id" | "month" | "category">
): string {
  return `${l.location_id ?? ZERO_UUID}|${l.month}|${l.category}`;
}

/**
 * The lines to insert into `targetMonth` from the previous month's lines with
 * `repeats = true`. Idempotent: a key that already has a row in the target
 * month (any value, a typed 0 included) is skipped, so running it twice gives
 * the same rows as once and an existing value is never overwritten.
 */
export function planRepeat(
  sourceLines: readonly FixedCostLine[],
  existingTargetLines: readonly FixedCostLine[],
  targetMonth: string,
  touchedKeys: ReadonlySet<string> = new Set()
): FixedCostLine[] {
  const taken = new Set([...existingTargetLines.map(lineKey), ...touchedKeys]);
  const out: FixedCostLine[] = [];
  for (const src of sourceLines) {
    if (!src.repeats) continue;
    const next: FixedCostLine = {
      ...src,
      id: undefined,
      month: targetMonth,
      source: "repeat",
      status: "confirmed",
    };
    const key = lineKey(next);
    if (taken.has(key)) continue;
    taken.add(key);
    out.push(next);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Group split
// ---------------------------------------------------------------------------

/**
 * Splits `totalCents` (an integer) across `weights` with the largest-remainder
 * method: every part is a whole number of cents and they add up to the total
 * exactly. Ties go to the earlier entry. With no usable weight it splits equally.
 */
export function splitLargestRemainder(
  totalCents: number,
  weights: readonly number[]
): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const w = sum > 0 ? clean : clean.map(() => 1);
  const wSum = sum > 0 ? sum : n;
  const exact = w.map((x) => (totalCents * x) / wSum);
  const parts = exact.map(Math.floor);
  let left = totalCents - parts.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % n, left--) parts[order[k].i] += 1;
  return parts;
}

export interface GroupSplitTarget {
  location_id: string;
  /** Sales of the month; only read by the `sales` rule. */
  sales: number | null;
}

export interface GroupShare {
  location_id: string;
  amount: number;
}

/**
 * Splits a group amount across restaurants. `sales` weights by each
 * restaurant's sales; with no sales anywhere (or `equal`) it splits equally.
 * The parts add up to the total to the cent.
 */
export function splitGroupAmount(
  total: number,
  rule: SplitRule,
  targets: readonly GroupSplitTarget[]
): GroupShare[] {
  const cents = Math.round(total * 100);
  const weights =
    rule === "sales" ? targets.map((t) => Math.max(0, t.sales ?? 0)) : [];
  const parts = splitLargestRemainder(
    cents,
    rule === "sales" ? weights : targets.map(() => 1)
  );
  return targets.map((t, i) => ({
    location_id: t.location_id,
    amount: parts[i] / 100,
  }));
}

// ---------------------------------------------------------------------------
// Effective costs and completeness
// ---------------------------------------------------------------------------

export interface EffectiveFixedCosts {
  /** null = missing (never 0). */
  amounts: Record<AmountCategory, number | null>;
  /** null = missing. */
  impuestosPct: number | null;
}

/**
 * What one restaurant carries for a month: its own lines plus its share of the
 * group lines (`groupShares`: category → amount for THIS restaurant). A
 * category with neither is null. A group impuestos % applies as is.
 */
export function effectiveFixedCosts(
  own: readonly Pick<FixedCostLine, "category" | "amount" | "pct_of_sales">[],
  groupShares: Partial<Record<AmountCategory, number>> = {},
  groupImpuestosPct: number | null = null
): EffectiveFixedCosts {
  const amounts = {} as Record<AmountCategory, number | null>;
  for (const cat of AMOUNT_CATEGORIES) {
    const mine = own.find((l) => l.category === cat && l.amount !== null);
    const shared = groupShares[cat];
    if (!mine && shared === undefined) amounts[cat] = null;
    else
      amounts[cat] =
        Math.round(((mine?.amount ?? 0) + (shared ?? 0)) * 100) / 100;
  }
  const tax = own.find(
    (l) => l.category === "impuestos" && l.pct_of_sales !== null
  );
  return {
    amounts,
    impuestosPct: tax ? tax.pct_of_sales : groupImpuestosPct,
  };
}

export interface FixedCostCompleteness {
  complete: boolean;
  /** Every missing item, impuestos included, for the ⚑ Falta flag. */
  missing: FixedCostCategory[];
  /** The four amount categories still missing (these block the break-even). */
  missingAmounts: AmountCategory[];
}

export function fixedCostCompleteness(
  costs: EffectiveFixedCosts
): FixedCostCompleteness {
  const missingAmounts = AMOUNT_CATEGORIES.filter(
    (c) => costs.amounts[c] === null
  );
  const missing: FixedCostCategory[] = [...missingAmounts];
  if (costs.impuestosPct === null) missing.push("impuestos");
  return { complete: missing.length === 0, missing, missingAmounts };
}

// ---------------------------------------------------------------------------
// Break-even
// ---------------------------------------------------------------------------

/**
 * Days the restaurant is open in `month`: the union of the weekdays (ISO,
 * 1 = Monday … 7 = Sunday) of its active shifts. No shifts → every day.
 */
export function openDaysInMonth(
  month: string,
  shiftWeekdays: readonly (readonly number[])[] | null
): number {
  const total = daysInMonth(month);
  const open = new Set<number>();
  for (const days of shiftWeekdays ?? [])
    for (const d of days) if (d >= 1 && d <= 7) open.add(d);
  if (open.size === 0) return total;
  const [y, m] = month.split("-").map(Number);
  let count = 0;
  for (let day = 1; day <= total; day++) {
    const js = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = Sunday
    if (open.has(js === 0 ? 7 : js)) count++;
  }
  return count;
}

export interface MarginInputs {
  /** Sales of the dishes whose ingredient cost is known. */
  sales: number;
  /** Ingredient cost of those same dishes. */
  foodCost: number;
  /** Unplanned waste; omit when there is no source (counts as none). */
  unplannedWaste?: number;
}

/**
 * Contribution margin as a fraction: (sales − food − unplanned waste −
 * impuestos% × sales) ÷ sales. Impuestos is a variable cost: it lowers the
 * margin and is never added to the fixed costs. null with no sales.
 */
export function contributionMarginPct(
  margin: MarginInputs,
  impuestosPct: number | null
): number | null {
  if (!Number.isFinite(margin.sales) || margin.sales <= 0) return null;
  const tax = ((impuestosPct ?? 0) / 100) * margin.sales;
  return (
    (margin.sales - margin.foodCost - (margin.unplannedWaste ?? 0) - tax) /
    margin.sales
  );
}

/**
 * breakEvenPerDay = fixedCosts ÷ (contributionMarginPct × openDays).
 * null (never 0) when any of the 4 categories is missing, there is no margin
 * (or it is not positive), or there are no open days. A typed 0 counts as
 * filled. A missing Impuestos % is calculated as 0% (the caller says so).
 */
export function breakEvenPerDay(args: {
  amounts: Record<AmountCategory, number | null>;
  impuestosPct: number | null;
  margin: MarginInputs | null;
  openDays: number;
}): number | null {
  let fixed = 0;
  for (const cat of AMOUNT_CATEGORIES) {
    const v = args.amounts[cat];
    if (v === null || !Number.isFinite(v)) return null;
    fixed += v;
  }
  if (!args.margin || args.openDays <= 0) return null;
  const cm = contributionMarginPct(args.margin, args.impuestosPct);
  if (cm === null || cm <= 0) return null;
  return fixed / (cm * args.openDays);
}
