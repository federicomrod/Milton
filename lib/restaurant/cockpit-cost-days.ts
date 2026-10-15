// lib/restaurant/cockpit-cost-days.ts
//
// R1-16b: the day × category cost rows of the Cockpit. net sales and units per
// day and product come from migration 053 (or, when it is not applied, from the
// raw rows with the same rules); each product's unit cost and category come
// from the same dish costing as Menú. Cost is only counted for products with a
// known cost — everything else is uncosted, never $0 — and a product with no
// category is «Sin categoría», never a guessed one.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CockpitFactRow } from "@/lib/restaurant/cockpit-aggregates";
import { localSaleDateKey } from "@/lib/restaurant/cockpit-executive";
import { classifySaleLine } from "@/lib/restaurant/sales-revenue";
import { odooProductIdFromMetadata } from "@/lib/restaurant/pos-product-links";
import { NO_CATEGORY, type MixDayRow } from "@/lib/restaurant/cockpit-v2";
import type { DishEconomicsResult } from "@/lib/restaurant/costing/dish-economics";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";

export const COCKPIT_PRODUCT_DAY_RPC = "cockpit_product_day_rollup";

export interface DayProduct {
  date: string;
  location_id: string | null;
  product_id: number | null;
  category: string | null;
  net: number;
  units: number;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function parseDayProducts(raw: unknown): DayProduct[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DayProduct[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const date = str(r.d);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      location_id: str(r.l),
      product_id: typeof r.p === "number" && Number.isInteger(r.p) ? r.p : null,
      category: str(r.c),
      net: num(r.n),
      units: num(r.u),
    });
  }
  return out;
}

/** The same groups from raw rows (tips out, local date, same currency rule). */
export function dayProductsFromRows(
  rows: ReadonlyArray<
    CockpitFactRow & {
      location_id?: string | null;
      source_metadata?: Record<string, unknown> | null;
    }
  >,
  timezone: string,
  currency?: string
): DayProduct[] {
  const tz = normalizeTimezone(timezone) ?? "UTC";
  const groups = new Map<string, DayProduct>();
  for (const row of rows) {
    if (currency && row.currency && row.currency !== currency) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sale_date)) continue;
    const classified = classifySaleLine(row);
    if (classified.isTip) continue;
    const date = localSaleDateKey(row, tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const product_id = odooProductIdFromMetadata(row.source_metadata ?? null);
    const category = row.category?.trim() ? row.category.trim() : null;
    const location_id = row.location_id ?? null;
    const key = `${date}|${location_id ?? ""}|${product_id ?? ""}|${category ?? ""}`;
    const g = groups.get(key) ?? {
      date,
      location_id,
      product_id,
      category,
      net: 0,
      units: 0,
    };
    g.net += classified.net;
    g.units +=
      typeof row.quantity === "number" && Number.isFinite(row.quantity)
        ? row.quantity
        : 0;
    groups.set(key, g);
  }
  return [...groups.values()];
}

export interface CostResolver {
  /** Unit cost of a product for a restaurant, or null (uncosted — never 0). */
  unitCostOf(
    productId: number | null,
    locationId: string | null
  ): number | null;
  /** The menu dish category of a product, or null. */
  categoryOf(productId: number | null): string | null;
}

/** Unit costs and categories from the same dish costing as Menú. */
export function resolverFromDishEconomics(
  result: Pick<
    DishEconomicsResult,
    "dishes" | "menu_dishes" | "excluded_menu_dishes"
  >
): CostResolver {
  const cost = new Map<string, number>();
  // The same rule as Menú and Resumen: a cost counts only when the dish is
  // COVERED (an approved cost). A product with a draft or missing cost is
  // uncosted, so the Cockpit's coverage and food cost % agree with Menú's.
  for (const dish of result.dishes) {
    const own = dish.unit_cost;
    for (const part of dish.parts ?? []) {
      if (
        !part.covered ||
        part.unit_cost === null ||
        !Number.isFinite(part.unit_cost)
      )
        continue;
      for (const loc of part.sales_scope?.sale_location_ids ?? [])
        cost.set(`${dish.odoo_product_id}@${loc}`, part.unit_cost);
    }
    if (dish.covered && own !== null && Number.isFinite(own))
      cost.set(String(dish.odoo_product_id), own);
  }
  const category = new Map<number, string>();
  for (const d of [...result.menu_dishes, ...result.excluded_menu_dishes]) {
    if (!d.category?.trim()) continue;
    for (const v of d.variants)
      category.set(v.odoo_product_id, d.category.trim());
  }
  return {
    unitCostOf: (pid, loc) =>
      pid === null
        ? null
        : (cost.get(`${pid}@${loc ?? ""}`) ?? cost.get(String(pid)) ?? null),
    categoryOf: (pid) => (pid === null ? null : (category.get(pid) ?? null)),
  };
}

/** Day × category rows: net, cost of the costed part, and the sales that cost covers. */
export function buildMixRows(
  products: readonly DayProduct[],
  resolver: CostResolver
): MixDayRow[] {
  const rows = new Map<string, MixDayRow>();
  for (const p of products) {
    if (!(p.net !== 0 || p.units !== 0)) continue;
    const category =
      resolver.categoryOf(p.product_id) ?? p.category ?? NO_CATEGORY;
    const unit = resolver.unitCostOf(p.product_id, p.location_id);
    const key = `${p.date}|${category}`;
    const r = rows.get(key) ?? {
      date: p.date,
      category,
      net: 0,
      cost: 0,
      covered_net: 0,
    };
    r.net += p.net;
    if (unit !== null) {
      r.cost += unit * p.units;
      r.covered_net += p.net;
    }
    rows.set(key, r);
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      net: Math.round(r.net * 100) / 100,
      cost: Math.round(r.cost * 100) / 100,
      covered_net: Math.round(r.covered_net * 100) / 100,
    }))
    .sort((a, b) =>
      a.date < b.date
        ? -1
        : a.date > b.date
          ? 1
          : a.category.localeCompare(b.category, "es")
    );
}

/** The day × product groups: the SQL function when applied, else the rows. */
export async function fetchDayProducts(
  supabase: SupabaseClient,
  companyId: string,
  options: {
    locationId: string | null;
    timezone: string;
    currency: string;
    loadRows: () => Promise<Parameters<typeof dayProductsFromRows>[0]>;
  }
): Promise<{ products: DayProduct[]; source: "rpc" | "rows" }> {
  try {
    const { data, error } = await supabase.rpc(COCKPIT_PRODUCT_DAY_RPC, {
      p_company_id: companyId,
      p_location_id: options.locationId,
      p_timezone: normalizeTimezone(options.timezone) ?? "UTC",
      p_currency: options.currency,
    });
    if (!error) {
      const parsed = parseDayProducts(data);
      if (parsed) return { products: parsed, source: "rpc" };
    }
  } catch {
    // fall through to the rows
  }
  const rows = await options.loadRows();
  return {
    products: dayProductsFromRows(rows, options.timezone, options.currency),
    source: "rows",
  };
}
