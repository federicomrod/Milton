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
//   discount_amount = price_unit * qty − price_subtotal
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

const TIP_HEADS = new Set([
  "propina",
  "propinas",
  "tip",
  "tips",
  "gratuity",
  "gratuities",
]);

const TIP_TRAILING = new Set([
  "servicio",
  "service",
  "pct",
  "percent",
  "%",
]);

/** Accent-fold + collapse punctuation so "Propína 10%" matches. */
export function foldTipKey(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/**
 * True when the POS product name is a tip / Propina line — not a dish
 * that happens to contain the word "tip" ("steak tip" stays a dish).
 */
export function isTipLineName(name: string | null | undefined): boolean {
  const key = foldTipKey(name ?? "");
  if (!key) return false;
  if (TIP_HEADS.has(key)) return true;
  const [head, ...rest] = key.split(/\s+/);
  if (!TIP_HEADS.has(head)) return false;
  return rest.every(
    (token) =>
      TIP_HEADS.has(token) || TIP_TRAILING.has(token) || /^\d/.test(token)
  );
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
}

export function classifySaleLine(
  row: TipClassifiableRow & {
    gross_revenue?: number | null;
    net_revenue?: number | null;
    revenue?: number | null;
    discount_amount?: number | null;
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
    };
  }
  const discount = lineDiscountAmount(row);
  return {
    isTip: false,
    posted,
    net: posted,
    discount,
    gross: posted + discount,
    tip: 0,
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
}

export function emptyRevenueBreakdown(): RevenueBreakdown {
  return {
    gross_sales: 0,
    discounts: 0,
    net_sales: 0,
    tips: 0,
    odoo_like_total: 0,
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
  };
}
