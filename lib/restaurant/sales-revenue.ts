// lib/restaurant/sales-revenue.ts
//
// Shared revenue definition for the restaurant cockpit and Ask Milton.
// Product lock (Fede, 2026-10-11, issue #123 step 1):
//
//   • Cockpit revenue EXCLUDES tips (Propina / tip lines).
//   • Tips are reported on their own line. Milton totals differ from
//     Odoo's by that tip amount — that difference is intentional.
//   • Show gross sales, discounts, and net sales.
//   • NET drives every KPI (avg ticket, tickets, heatmap, dayparts,
//     channel/payment mix, and later food-cost % / margin).
//
// How a POS line is stored today (Odoo sync, lib/restaurant/odoo/sync.ts):
//   gross_revenue   = price_subtotal_incl  (tax-incl, POST-discount)
//   net_revenue     = price_subtotal       (tax-excl, POST-discount)
//   discount_amount = % of price_unit*qty when Odoo exposes `discount`;
//                     otherwise the old price_unit*qty − price_subtotal
//                     fallback (flagged estimated in the UI)
//
// The cockpit has always used posted (tax-incl, post-discount) revenue
// — `gross_revenue`, falling back to `net_revenue`. That is unchanged.
// "Gross sales" / "net sales" below are the *product* names:
//
//   posted   = gross_revenue ?? net_revenue ?? 0     (same as before)
//   tip      = posted, when the line is a tip; else 0
//   net      = posted, when the line is NOT a tip; else 0
//   discount = discount_amount, when the line is NOT a tip; else 0
//   gross    = net + discount
//
// For a period with no tips, net === today's cockpit total.
// For a period with tips, net === today's cockpit total − tips.
//
// Tip detection: `is_tip === true` when the column is populated (migration
// 030 + Odoo sync). NULL / missing falls back to the product name
// (Propina, tip, …) so already-synced July rows classify without a re-sync.

export const DINNER_START_HOUR = 17;

/** Same accent fold as ask-milton-sales `foldText` — kept local to avoid a cycle. */
function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Local hour ≥ 17:00 is dinner; 00:00–16:59 is lunch.
 * Matches typical Los Ranchos / Lavara service (lunch through mid-
 * afternoon, dinner from 5pm). Hours without `order_placed_at` are
 * omitted from the daypart split — they still count in date-based KPIs.
 */
export type Daypart = "lunch" | "dinner";

export function daypartFromLocalHour(hour: number): Daypart {
  return hour >= DINNER_START_HOUR ? "dinner" : "lunch";
}

/**
 * Fede has not decided whether service-charge lines are tips.
 * Flip this to `true` to treat SERVICE_CHARGE_NAMES as tips — one-line
 * change; isTipLineName / tests read this constant.
 */
export const SERVICE_CHARGE_NAMES_ARE_TIPS = false;

/** Names left as revenue until Fede decides. Matched after accent-fold. */
export const SERVICE_CHARGE_NAMES = [
  "Servicio 10%",
  "Cargo por servicio",
  "Service charge",
] as const;

/** Whole-word `tip` may be followed only by these (or punctuation / digits / %). */
const TIP_WORD_SUFFIXES = new Set([
  "jar",
  "sugerido",
  "sugerida",
  "sugeridas",
  "sugeridos",
  "voluntaria",
  "voluntario",
  "voluntarias",
  "voluntarios",
  "tarjeta",
  "tarjetas",
  "servicio",
  "service",
  "pct",
  "percent",
]);

/** Accent-fold + collapse punctuation so "Propína 10%" matches. */
export function foldTipKey(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

function tipTokens(key: string): string[] {
  return key.split(/\s+/).filter(Boolean);
}

function isDigitOrPercentToken(token: string): boolean {
  return token === "%" || /^\d/.test(token);
}

function isServiceChargeKey(key: string): boolean {
  return SERVICE_CHARGE_NAMES.some((name) => foldTipKey(name) === key);
}

function isAllowedTipWordSuffix(token: string): boolean {
  return TIP_WORD_SUFFIXES.has(token) || isDigitOrPercentToken(token);
}

/**
 * True when the POS product name is a tip / Propina line — not a dish
 * that happens to contain the word "tip" ("steak tip" stays a dish).
 *
 *   • starts with the whole word `propina` / `propinas` (any suffix)
 *   • equals / starts with whole-word `tip` followed only by punctuation,
 *     digits, %, or jar / sugerido-style suffixes
 *   • equals / starts with whole-word `tips` / `gratuity` / `gratuities`
 *
 * Pass `serviceChargesAreTips` to exercise the pending Fede decision;
 * production callers omit it and read SERVICE_CHARGE_NAMES_ARE_TIPS.
 */
export function isTipLineName(
  name: string | null | undefined,
  serviceChargesAreTips: boolean = SERVICE_CHARGE_NAMES_ARE_TIPS
): boolean {
  const key = foldTipKey(name ?? "");
  if (!key) return false;
  const tokens = tipTokens(key);
  const head = tokens[0];
  if (!head) return false;

  if (head === "propina" || head === "propinas") return true;
  if (head === "tips" || head === "gratuity" || head === "gratuities") {
    return true;
  }
  if (head === "tip" && tokens.slice(1).every(isAllowedTipWordSuffix)) {
    return true;
  }
  if (serviceChargesAreTips && isServiceChargeKey(key)) return true;
  return false;
}

export interface TipClassifiableRow {
  is_tip?: boolean | null;
  raw_item_name?: string | null;
  item_name?: string | null;
}

/** Column wins when set; otherwise the product name. */
export function isTipSaleRow(row: TipClassifiableRow): boolean {
  if (row.is_tip === true) return true;
  if (row.is_tip === false) return false;
  return isTipLineName(row.raw_item_name ?? row.item_name);
}

export function postedRevenue(row: {
  gross_revenue?: number | null;
  net_revenue?: number | null;
  revenue?: number | null;
}): number {
  if (typeof row.gross_revenue === "number" && Number.isFinite(row.gross_revenue)) {
    return row.gross_revenue;
  }
  if (typeof row.net_revenue === "number" && Number.isFinite(row.net_revenue)) {
    return row.net_revenue;
  }
  if (typeof row.revenue === "number" && Number.isFinite(row.revenue)) {
    return row.revenue;
  }
  return 0;
}

export function lineDiscountAmount(row: {
  discount_amount?: number | null;
}): number {
  return typeof row.discount_amount === "number" &&
    Number.isFinite(row.discount_amount)
    ? row.discount_amount
    : 0;
}

export interface ClassifiedSaleLine {
  isTip: boolean;
  posted: number;
  net: number;
  discount: number;
  gross: number;
  tip: number;
  discountEstimated: boolean;
}

export function classifySaleLine(
  row: TipClassifiableRow & {
    gross_revenue?: number | null;
    net_revenue?: number | null;
    revenue?: number | null;
    discount_amount?: number | null;
    discount_estimated?: boolean | null;
    source_metadata?: { discount_estimated?: boolean } | null;
  }
): ClassifiedSaleLine {
  const posted = postedRevenue(row);
  if (isTipSaleRow(row)) {
    return {
      isTip: true,
      posted,
      net: 0,
      discount: 0,
      gross: 0,
      tip: posted,
      discountEstimated: false,
    };
  }
  const discount = lineDiscountAmount(row);
  const discountEstimated =
    row.discount_estimated === true ||
    row.source_metadata?.discount_estimated === true;
  return {
    isTip: false,
    posted,
    net: posted,
    discount,
    gross: posted + discount,
    tip: 0,
    discountEstimated,
  };
}

export interface RevenueBreakdown {
  /** Pre-discount, tips excluded. */
  gross_sales: number;
  /** Discount dollars on non-tip lines. */
  discounts: number;
  /** Post-discount, tips excluded. Drives every KPI. */
  net_sales: number;
  /** Propina / tip lines only. */
  tips: number;
  /**
   * Posted revenue including tips — equals today's (pre-#123) cockpit
   * total, so we can show "differs from Odoo by the tip amount".
   */
  odoo_like_total: number;
  /**
   * True when at least one non-tip line's discount came from the
   * price_unit*qty − price_subtotal fallback (Odoo `discount` % missing).
   */
  discounts_estimated: boolean;
}

export function emptyRevenueBreakdown(): RevenueBreakdown {
  return {
    gross_sales: 0,
    discounts: 0,
    net_sales: 0,
    tips: 0,
    odoo_like_total: 0,
    discounts_estimated: false,
  };
}

export function addClassifiedLine(
  acc: RevenueBreakdown,
  line: ClassifiedSaleLine
): void {
  acc.gross_sales += line.gross;
  acc.discounts += line.discount;
  acc.net_sales += line.net;
  acc.tips += line.tip;
  acc.odoo_like_total += line.posted;
  if (line.discountEstimated) acc.discounts_estimated = true;
}

export function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

export function finalizeRevenueBreakdown(
  acc: RevenueBreakdown
): RevenueBreakdown {
  return {
    gross_sales: roundMoney(acc.gross_sales),
    discounts: roundMoney(acc.discounts),
    net_sales: roundMoney(acc.net_sales),
    tips: roundMoney(acc.tips),
    odoo_like_total: roundMoney(acc.odoo_like_total),
    discounts_estimated: acc.discounts_estimated,
  };
}
