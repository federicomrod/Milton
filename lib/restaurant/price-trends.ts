// lib/restaurant/price-trends.ts
//
// Pure ingredient price-trend logic shared by the profitability aggregator,
// the daily briefing and the Supplier Agent. No I/O.
//
// Rules:
//   1. ONE final price per ingredient per day: the entry with the latest
//      created_at that day. A same-day correction is therefore never an
//      "increase" — only the day's final price is compared.
//   2. The latest day's final price is compared with the most recent EARLIER
//      day's final price in the same normalized unit.
//   3. Implausible jumps are not alerts (see thresholds), they are listed as
//      "revisar precio" so a person checks the entry instead of being told
//      the supplier raised the price by hundreds of percent.

/** Minimal structural shape of an ingredient cost entry. */
export interface TrendCostEntry {
  cost_date: string;
  created_at: string;
  normalized_unit: string;
  normalized_unit_cost: number;
  currency: string;
  supplier_id: string | null;
}

/**
 * Prices are stored per normalized unit (e.g. per gram or per ml), so a
 * perfectly normal ingredient can cost a fraction of a cent per unit. A tiny
 * base price makes the percentage explode on the slightest rounding or
 * unit-entry slip (0.0023 -> 0.0100 is +334%), which is almost always a data
 * problem, not a real supplier move.
 */
export const PRICE_TREND_TINY_PREVIOUS_UNIT_PRICE = 0.005;

/**
 * A change above this percentage, on a tiny previous price (see above), is
 * treated as implausible and listed as "revisar precio" instead of an alert.
 */
export const PRICE_TREND_IMPLAUSIBLE_PCT = 200;

/**
 * An INCREASE above this percentage is never shown as a supplier price
 * alert, whatever the price size: a price that more than doubles overnight is
 * far more often a typo or a unit slip than a real move, so a person is asked
 * «¿Es correcto?» instead (neutral, no percentage, no red arrow). Increases
 * up to this keep the normal alert.
 */
export const PRICE_TREND_REVIEW_INCREASE_PCT = 100;

/**
 * Absolute change per normalized unit below which the move is noise (a
 * rounding difference), regardless of the percentage. Also drops "no change".
 */
export const PRICE_TREND_NEGLIGIBLE_ABS_CHANGE = 0.0001;

export type PriceTrendOutcome<E extends TrendCostEntry> =
  | {
      kind: "alert";
      latest: E;
      previous: E;
      pct_change: number;
    }
  | {
      kind: "review";
      latest: E;
      previous: E;
      pct_change: number;
    }
  | { kind: "none" };

/** Latest created_at per cost_date; sorted newest day first. */
export function collapseToDailyFinalPrices<E extends TrendCostEntry>(
  entries: readonly E[]
): E[] {
  const byDay = new Map<string, E>();
  for (const e of entries) {
    if (
      !e.cost_date ||
      !Number.isFinite(e.normalized_unit_cost) ||
      e.normalized_unit_cost <= 0
    ) {
      continue;
    }
    const cur = byDay.get(e.cost_date);
    if (!cur || (e.created_at ?? "") > (cur.created_at ?? "")) {
      byDay.set(e.cost_date, e);
    }
  }
  return [...byDay.values()].sort((a, b) =>
    a.cost_date === b.cost_date ? 0 : a.cost_date > b.cost_date ? -1 : 1
  );
}

export function evaluateIngredientPriceTrend<E extends TrendCostEntry>(
  entries: readonly E[]
): PriceTrendOutcome<E> {
  const days = collapseToDailyFinalPrices(entries);
  if (days.length < 2) return { kind: "none" };
  const latest = days[0];
  const previous = days
    .slice(1)
    .find((e) => e.normalized_unit === latest.normalized_unit);
  if (!previous) return { kind: "none" };

  const abs = latest.normalized_unit_cost - previous.normalized_unit_cost;
  if (Math.abs(abs) < PRICE_TREND_NEGLIGIBLE_ABS_CHANGE)
    return { kind: "none" };
  const pct = (abs / previous.normalized_unit_cost) * 100;
  if (
    pct > PRICE_TREND_REVIEW_INCREASE_PCT ||
    (previous.normalized_unit_cost < PRICE_TREND_TINY_PREVIOUS_UNIT_PRICE &&
      Math.abs(pct) > PRICE_TREND_IMPLAUSIBLE_PCT)
  ) {
    return { kind: "review", latest, previous, pct_change: pct };
  }
  return { kind: "alert", latest, previous, pct_change: pct };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Decimals needed to show at least 2 significant digits of `n`. */
export function decimalsForUnitPrice(n: number): number {
  const a = Math.abs(n);
  if (!Number.isFinite(a) || a === 0) return 2;
  if (a >= 1) return 2;
  const lead = -Math.floor(Math.log10(a)); // 0.0023 -> 3
  return Math.min(8, Math.max(2, lead + 1));
}

function fmtWithDecimals(n: number, currency: string, d: number): string {
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(n);
  } catch {
    return `${n.toFixed(d)} ${currency}`;
  }
}

/** "USD 0.0023" — enough decimals to never collapse to "0". */
export function formatUnitPrice(n: number, currency: string): string {
  return fmtWithDecimals(n, currency, decimalsForUnitPrice(n));
}

/** Both prices with the same decimals so the change is visible. */
export function formatUnitPricePair(
  previous: number,
  latest: number,
  currency: string
): { previous: string; latest: string } {
  const d = Math.max(
    decimalsForUnitPrice(previous),
    decimalsForUnitPrice(latest)
  );
  return {
    previous: fmtWithDecimals(previous, currency, d),
    latest: fmtWithDecimals(latest, currency, d),
  };
}
