// lib/restaurant/pos-sales-groups.ts
//
// R1-12: the dish list is built from Odoo POS lines. Instead of paging
// ~20k raw rows (1000 per request), migration 046 sums them inside
// Postgres (pos_product_sales_groups) and returns one jsonb value. Each
// group is turned back into synthetic lines and fed to the SAME
// buildPosProductList, so tip rules, rounding and combo roll-up stay in
// one place (pos-product-list.ts) and the numbers cannot drift.
//
// If the function is missing (046 not applied) or errors, the caller
// falls back to the raw-row walk — slower, same numbers.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PosSaleLineForProductList } from "@/lib/restaurant/pos-product-list";

/** One row of pos_product_sales_groups(). */
export interface PosSalesGroup {
  location_id: string | null;
  product_id: number;
  parent_product_id: number | null;
  name: string;
  is_tip: boolean | null;
  category: string | null;
  quantity: number | string;
  gross_revenue: number | string;
  line_count: number;
  first_id: string;
  last_id: string;
}

/**
 * Lines are walked in id order by the builder: the LAST non-empty name
 * wins, the FIRST non-empty category wins. A group spans many ids, so it
 * becomes (a) one money line at its last id, and (b) when it has a
 * category and is a stand-alone line, a zero line at its first id that
 * only carries the category.
 */
export function groupsToSyntheticLines(
  companyId: string,
  groups: readonly PosSalesGroup[]
): PosSaleLineForProductList[] {
  const keyed: Array<{
    key: string;
    order: 0 | 1;
    line: PosSaleLineForProductList;
  }> = [];
  for (const g of groups) {
    const base = {
      company_id: companyId,
      location_id: g.location_id,
      raw_item_name: g.name,
      is_tip: g.is_tip,
      source_metadata: { product_id: g.product_id },
    };
    const isChild =
      g.parent_product_id != null && g.parent_product_id !== g.product_id;
    keyed.push({
      key: g.last_id,
      order: 1,
      line: {
        ...base,
        quantity: Number(g.quantity),
        gross_revenue: Number(g.gross_revenue),
        net_revenue: null,
        category: null,
        combo_parent_odoo_product_id: g.parent_product_id,
      },
    });
    if (g.category && !isChild) {
      keyed.push({
        key: g.first_id,
        order: 0,
        line: {
          ...base,
          quantity: 0,
          gross_revenue: 0,
          net_revenue: null,
          category: g.category,
        },
      });
    }
  }
  keyed.sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : a.order - b.order
  );
  return keyed.map((k) => k.line);
}

/** When the function is missing, do not pay a failed call every load. */
let unavailableUntil = 0;
const UNAVAILABLE_MS = 60_000;

export interface SalesGroupsParams {
  companyId: string;
  locationId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  odooProductId?: number | null;
}

export type SalesGroupsRead =
  | { ok: true; lines: PosSaleLineForProductList[]; groups: number }
  | { ok: false };

export async function loadPosSalesGroups(
  supabase: SupabaseClient,
  params: SalesGroupsParams
): Promise<SalesGroupsRead> {
  if (Date.now() < unavailableUntil) return { ok: false };
  const { data, error } = await supabase.rpc("pos_product_sales_groups", {
    p_company_id: params.companyId,
    p_location_id: params.locationId ?? null,
    p_from: params.startDate ?? null,
    p_to: params.endDate ?? null,
    p_odoo_product_id: params.odooProductId ?? null,
  });
  if (error || !Array.isArray(data)) {
    if (error) {
      console.warn(
        "[pos-sales-groups] rpc unavailable, reading rows:",
        error.message
      );
      unavailableUntil = Date.now() + UNAVAILABLE_MS;
    }
    return { ok: false };
  }
  return {
    ok: true,
    lines: groupsToSyntheticLines(params.companyId, data as PosSalesGroup[]),
    groups: data.length,
  };
}
