// lib/restaurant/cockpit-cost-coverage.ts
//
// Cost coverage is the share of NET SALES that comes from dishes with a
// known cost — not the share of ingredients mapped. Issue #129 / #123.

import { classifySaleLine } from "@/lib/restaurant/sales-revenue";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";

export interface CoverageLine {
  /** Net sales for this line (tips already excluded). */
  net: number;
  /** True when the dish has a complete recipe cost. */
  has_cost: boolean;
}

export interface SalesWeightedCoverage {
  net_sales: number;
  covered_sales: number;
  /** 0–100. 0 when there is no net sales (never NaN). */
  coverage_pct: number;
}

export function salesWeightedCoverage(
  lines: CoverageLine[]
): SalesWeightedCoverage {
  let netSales = 0;
  let coveredSales = 0;
  for (const line of lines) {
    if (!Number.isFinite(line.net)) continue;
    netSales += line.net;
    if (line.has_cost) coveredSales += line.net;
  }
  const coveragePct = netSales > 0 ? (coveredSales / netSales) * 100 : 0;
  return {
    net_sales: round2(netSales),
    covered_sales: round2(coveredSales),
    coverage_pct: round1(coveragePct),
  };
}

export interface ItemCostLookup {
  /** menu_item_id → complete-cost unit cost (null if incomplete). */
  unitCostByMenuItemId: Map<string, number | null>;
  /** Lowercased raw POS name → menu_item_id (optional). */
  menuItemIdByRawName?: Map<string, string>;
}

export interface PeriodCostKpis {
  coverage_pct: number;
  covered_net: number;
  estimated_cogs: number;
  food_cost_pct: number | null;
  gross_margin_pct: number | null;
}

/**
 * Sales-weighted cost KPIs for already-filtered period rows. COGS / margin
 * only include lines whose dish has a complete cost — same honesty rule as
 * profitability-server and the owners' email briefing.
 */
export function periodCostKpisFromRows(
  rows: CockpitFactRow[],
  lookup: ItemCostLookup,
  currency?: string
): PeriodCostKpis {
  const lines: CoverageLine[] = [];
  let cogs = 0;
  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    const classified = classifySaleLine(row);
    if (classified.isTip) continue;
    const menuItemId = resolveMenuItemId(row, lookup);
    const unitCost = menuItemId
      ? (lookup.unitCostByMenuItemId.get(menuItemId) ?? null)
      : null;
    const hasCost = unitCost !== null && Number.isFinite(unitCost);
    lines.push({ net: classified.net, has_cost: hasCost });
    if (hasCost) {
      const qty =
        typeof row.quantity === "number" && Number.isFinite(row.quantity)
          ? row.quantity
          : 0;
      cogs += (unitCost as number) * qty;
    }
  }
  const coverage = salesWeightedCoverage(lines);
  const foodCostPct =
    coverage.covered_sales > 0 ? (cogs / coverage.covered_sales) * 100 : null;
  const grossMarginPct =
    coverage.covered_sales > 0
      ? ((coverage.covered_sales - cogs) / coverage.covered_sales) * 100
      : null;
  return {
    coverage_pct: coverage.coverage_pct,
    covered_net: coverage.covered_sales,
    estimated_cogs: round2(cogs),
    food_cost_pct: foodCostPct === null ? null : round1(foodCostPct),
    gross_margin_pct: grossMarginPct === null ? null : round1(grossMarginPct),
  };
}

export function itemCostLookupFromMarginRows(
  rows: Array<{
    menu_item_id: string;
    raw_pos_names: string[];
    cost: { status: string; cost: number | null };
  }>
): ItemCostLookup {
  const unitCostByMenuItemId = new Map<string, number | null>();
  const menuItemIdByRawName = new Map<string, string>();
  for (const row of rows) {
    const complete =
      row.cost.status === "complete" &&
      row.cost.cost !== null &&
      Number.isFinite(row.cost.cost);
    unitCostByMenuItemId.set(row.menu_item_id, complete ? row.cost.cost : null);
    for (const name of row.raw_pos_names) {
      const key = name.trim().toLowerCase();
      if (key) menuItemIdByRawName.set(key, row.menu_item_id);
    }
  }
  return { unitCostByMenuItemId, menuItemIdByRawName };
}

function resolveMenuItemId(
  row: CockpitFactRow & { menu_item_id?: string | null },
  lookup: ItemCostLookup
): string | null {
  const direct = row.menu_item_id?.trim();
  if (direct) return direct;
  const raw = (row.raw_item_name ?? row.item_name ?? "").trim().toLowerCase();
  if (!raw || !lookup.menuItemIdByRawName) return null;
  return lookup.menuItemIdByRawName.get(raw) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
