// lib/restaurant/menu-resumen-data.ts
//
// R1-18: builds the one dataset of Menú › Resumen (see menu-resumen.ts) from
// the sales per day and product (the same read as the Cockpit's cost rows) and
// the menu dishes of the shared dish-economics load. Pure.

import type { DayProduct } from "@/lib/restaurant/cockpit-cost-days";
import type { MenuDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { addDays } from "@/lib/restaurant/cockpit-math";
import type {
  ResumenData,
  ResumenDayRow,
  ResumenDish,
} from "@/lib/restaurant/menu-resumen";

/** Business days kept: a 90-day range plus margin. */
export const RESUMEN_WINDOW_DAYS = 460;

export function buildResumenData(input: {
  currency: string;
  products: readonly DayProduct[];
  menuDishes: readonly MenuDish[];
}): ResumenData {
  const dishes: ResumenDish[] = input.menuDishes.map((d) => ({
    id: d.id,
    name: d.name,
    variants: d.variants.map((v) => ({
      key: v.key,
      product_id: v.odoo_product_id,
      locations: v.sales_scope?.sale_location_ids ?? null,
      unit_cost: v.unit_cost,
      covered: v.covered,
      status: v.status,
    })),
  }));
  const foodProducts = new Set<number>();
  for (const d of dishes)
    for (const v of d.variants) foodProducts.add(v.product_id);

  let last: string | null = null;
  let first: string | null = null;
  const grouped = new Map<string, ResumenDayRow>();
  for (const p of input.products) {
    if (p.product_id === null || !foodProducts.has(p.product_id)) continue;
    if (last === null || p.date > last) last = p.date;
    if (first === null || p.date < first) first = p.date;
    const key = `${p.date}|${p.location_id ?? ""}|${p.product_id}`;
    const row = grouped.get(key) ?? {
      d: p.date,
      l: p.location_id,
      p: p.product_id,
      n: 0,
      u: 0,
    };
    row.n += p.net;
    row.u += p.units;
    grouped.set(key, row);
  }
  const from = last ? addDays(last, -(RESUMEN_WINDOW_DAYS - 1)) : null;
  const days = [...grouped.values()]
    .filter((r) => from === null || r.d >= from)
    .map((r) => ({
      ...r,
      n: Math.round(r.n * 100) / 100,
      u: Math.round(r.u * 1000) / 1000,
    }))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.p - b.p));
  return {
    currency: input.currency,
    dishes,
    days,
    first_day: first,
    last_day: last,
  };
}
