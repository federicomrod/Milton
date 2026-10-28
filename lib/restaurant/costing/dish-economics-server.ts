// lib/restaurant/costing/dish-economics-server.ts
//
// Loads what buildDishEconomics needs, once per request. Company id comes
// from auth, never from the request. Every query is company-scoped and
// runs through the caller's RLS-bound client.

import { cache } from "react";
import type { CostingData } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import type {
  StoredMenuDish,
  StoredVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import {
  loadItemGroups,
  type ItemGroupsLoad,
} from "@/lib/restaurant/groups/item-groups";
import type { PosProductListResult } from "@/lib/restaurant/pos-product-list";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  evidenceLinesOf,
  type CostingLoad,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  latestPrice,
  type PriceMeta,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import {
  buildDishEconomics,
  type DishEconomicsResult,
  type DishVersion,
} from "./dish-economics";

export interface DishEconomicsParams {
  companyId: string;
  /** Inclusive sale_date range; null = every loaded sale. */
  from?: string | null;
  to?: string | null;
  locationId?: string | null;
  /** One dish only (the open dish after an edit): no full sales scan. */
  odooProductId?: number | null;
  /**
   * Cost as of this day (YYYY-MM-DD): the latest price on or before it and the
   * approved recipe version in force. Omitted = today's prices.
   */
  asOfDate?: string | null;
}

/** The same costing data with only the price entries dated on or before `asOfDate`. */
export function costingAsOf(data: CostingData, asOfDate: string): CostingData {
  const entries = new Map<string, IngredientCostEntry[]>();
  for (const [id, list] of data.costEntriesByIngredientId) {
    entries.set(
      id,
      list.filter((e) => (e.effective_date || e.cost_date) <= asOfDate)
    );
  }
  return { ...data, costEntriesByIngredientId: entries };
}

export type DishEconomicsLoad =
  | {
      ok: true;
      result: DishEconomicsResult;
      /** The ranked POS list the result was built from (Recetas queues). */
      list: PosProductListResult;
      ms: number;
    }
  | { ok: false; error: string };

const VERSION_SELECT =
  "id, menu_item_id, version_number, status, effective_date, approved_at, created_at, notes";
const INPUT_SELECT =
  "id, recipe_version_id, input_type, ingredient_id, component_id, quantity, unit, unit_cost, cost_source";

/** Everything except the period's sales: recipes, lines and prices. */
export interface DishCostContext {
  versions: DishVersion[];
  inputsByVersionId: Map<string, VersionInput[]>;
  costing: CostingLoad;
  currency: string;
  /** R1-10 (045). Empty, and `menuDishesStored` false, before 045. */
  storedMenuDishes: StoredMenuDish[];
  /** Every link's stored grouping (a product may have several links). */
  storedVariantRows: StoredVariantRow[];
  menuDishesStored: boolean;
  /** R1-15b (048). Empty, and `available` false, before 048. */
  itemGroups: ItemGroupsLoad;
}

type StoredVariantRow = StoredVariant & { location_id: string | null };

/**
 * One stored grouping per product for the selected restaurant: its own
 * link first, then the company-wide one, then (Todos) any link that has a
 * grouping. A restaurant-only dish only applies to its restaurant.
 */
export function storedVariantsFor(
  rows: readonly StoredVariantRow[],
  dishes: readonly StoredMenuDish[],
  locationId: string | null
): Map<number, StoredVariant> {
  const restaurantOf = new Map(dishes.map((d) => [d.id, d.restaurant_id]));
  const rank = (row: StoredVariantRow) => {
    if (locationId && row.location_id === locationId) return 0;
    if (row.location_id == null) return 1;
    if (!locationId && (row.menu_dish_id || row.excluded_reason)) return 2;
    return 3;
  };
  const out = new Map<number, StoredVariant>();
  const best = new Map<number, number>();
  for (const row of rows) {
    const r = rank(row);
    if (r === 3 && locationId) continue;
    const dishRestaurant = row.menu_dish_id
      ? restaurantOf.get(row.menu_dish_id)
      : null;
    if (dishRestaurant && locationId && dishRestaurant !== locationId) continue;
    if ((best.get(row.odoo_product_id) ?? 99) <= r) continue;
    best.set(row.odoo_product_id, r);
    out.set(row.odoo_product_id, {
      odoo_product_id: row.odoo_product_id,
      menu_dish_id: row.menu_dish_id,
      portion_qty: row.portion_qty,
      side_label: row.side_label,
      cooking_point: row.cooking_point,
      is_event: row.is_event,
      excluded_reason: row.excluded_reason,
    });
  }
  return out;
}

/** Stored menu dishes and each variant's grouping (045), if applied. */
async function loadStoredGrouping(
  supabase: SupabaseClient,
  companyId: string
): Promise<{
  dishes: StoredMenuDish[];
  variants: StoredVariantRow[];
  stored: boolean;
}> {
  const empty = { dishes: [], variants: [], stored: false };
  const [dishesRes, linksRes] = await Promise.all([
    fetchAllRows<StoredMenuDish>(() =>
      supabase
        .from("menu_dishes")
        .select(
          "id, name, restaurant_id, category, recipe_id, base_portion_qty, base_portion_unit, source, status"
        )
        .eq("company_id", companyId)
    ),
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("pos_product_links")
        .select(
          "id, location_id, odoo_product_id, menu_dish_id, portion_qty, side_label, cooking_point, is_event, excluded_reason"
        )
        .eq("company_id", companyId)
    ),
  ]);
  // Before 045 is applied the table and columns do not exist: group in
  // memory only (Milton's suggestion), with nothing stored.
  if (dishesRes.error || linksRes.error) return empty;
  const variants: StoredVariantRow[] = [];
  for (const row of linksRes.rows) {
    const id = Number(row.odoo_product_id);
    if (!Number.isInteger(id)) continue;
    variants.push({
      odoo_product_id: id,
      location_id: typeof row.location_id === "string" ? row.location_id : null,
      menu_dish_id:
        typeof row.menu_dish_id === "string" ? row.menu_dish_id : null,
      portion_qty: row.portion_qty == null ? null : Number(row.portion_qty),
      side_label: typeof row.side_label === "string" ? row.side_label : null,
      cooking_point:
        typeof row.cooking_point === "string" ? row.cooking_point : null,
      is_event: row.is_event === true,
      excluded_reason:
        typeof row.excluded_reason === "string" ? row.excluded_reason : null,
    });
  }
  return {
    dishes: dishesRes.rows.map((d) => ({
      ...d,
      base_portion_qty:
        d.base_portion_qty == null ? null : Number(d.base_portion_qty),
    })),
    variants,
    stored: true,
  };
}

/**
 * Never throws: a failed read (a missing table, a database error) is an
 * `ok: false` every screen already handles, not a server exception.
 */
export async function loadDishCostContextWith(
  supabase: SupabaseClient,
  companyId: string
): Promise<
  { ok: true; context: DishCostContext } | { ok: false; error: string }
> {
  try {
    return await loadDishCostContextUnsafe(supabase, companyId);
  } catch (err) {
    console.error(
      "[dish-economics] cost context failed:",
      err instanceof Error ? (err.stack ?? err.message) : err
    );
    return {
      ok: false,
      error: err instanceof Error ? err.message : "No pude leer tus costos.",
    };
  }
}

async function loadDishCostContextUnsafe(
  supabase: SupabaseClient,
  companyId: string
): Promise<
  { ok: true; context: DishCostContext } | { ok: false; error: string }
> {
  const [versionsRes, inputsRes, costing, currency, grouping, itemGroups] =
    await Promise.all([
      fetchAllRowsRetryingWithoutColumns<DishVersion>(
        ["approved_at"],
        (select) =>
          supabase
            .from("recipe_versions")
            .select(select)
            .eq("company_id", companyId),
        VERSION_SELECT,
        { hintKey: `recipe_versions:${companyId}` }
      ),
      fetchAllRowsRetryingWithoutColumns<Record<string, unknown>>(
        ["unit_cost", "cost_source"],
        (select) =>
          supabase
            .from("recipe_version_inputs")
            .select(select)
            .eq("company_id", companyId),
        INPUT_SELECT,
        // R1-12: ~1.4k rows today = two pages; ask for both at once.
        { hintKey: `recipe_version_inputs:${companyId}` }
      ),
      createSupabaseEditorStore(supabase).loadCosting(companyId),
      resolveCompanyCurrency(supabase, companyId),
      loadStoredGrouping(supabase, companyId),
      loadItemGroups(supabase, companyId),
    ]);
  if (versionsRes.error) {
    console.error("[dish-economics] recipe_versions:", versionsRes.error);
    return { ok: false, error: "No se pudieron leer las recetas." };
  }
  if (inputsRes.error) {
    console.error("[dish-economics] recipe_version_inputs:", inputsRes.error);
    return { ok: false, error: "No se pudieron leer las líneas de receta." };
  }
  const inputsByVersionId = new Map<string, VersionInput[]>();
  for (const row of inputsRes.rows) {
    const versionId = String(row.recipe_version_id);
    const list = inputsByVersionId.get(versionId) ?? [];
    list.push({
      id: String(row.id),
      input_type: row.input_type === "component" ? "component" : "ingredient",
      ingredient_id:
        typeof row.ingredient_id === "string" ? row.ingredient_id : null,
      component_id:
        typeof row.component_id === "string" ? row.component_id : null,
      quantity: Number(row.quantity),
      unit: String(row.unit),
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
      cost_source: typeof row.cost_source === "string" ? row.cost_source : null,
    });
    inputsByVersionId.set(versionId, list);
  }
  // Same order as the editor's listInputs (by id).
  for (const list of inputsByVersionId.values()) {
    list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return {
    ok: true,
    context: {
      versions: versionsRes.rows,
      inputsByVersionId,
      costing,
      currency: currency || "USD",
      storedMenuDishes: grouping.dishes,
      storedVariantRows: grouping.variants,
      menuDishesStored: grouping.stored,
      itemGroups,
    },
  };
}

/** Uncached: scripts and tests pass their own client. */
export async function loadDishEconomicsWith(
  supabase: SupabaseClient,
  params: DishEconomicsParams,
  context?: DishCostContext
): Promise<DishEconomicsLoad> {
  const started = Date.now();
  const { companyId } = params;
  try {
    const [listRes, contextRes] = await Promise.all([
      loadPosProductList(supabase, {
        companyId,
        startDate: params.from ?? null,
        endDate: params.to ?? null,
        locationId: params.locationId ?? null,
        odooProductId: params.odooProductId ?? null,
      }),
      context
        ? Promise.resolve({ ok: true as const, context })
        : loadDishCostContextWith(supabase, companyId),
    ]);
    if (!listRes.ok) return { ok: false, error: listRes.error };
    if (!contextRes.ok) return { ok: false, error: contextRes.error };
    const ctx = contextRes.context;

    const costingData = params.asOfDate
      ? costingAsOf(ctx.costing.data, params.asOfDate)
      : ctx.costing.data;
    const prices = new Map<string, PriceMeta | null>();
    const priceOf = (id: string): PriceMeta | null => {
      if (!prices.has(id)) {
        prices.set(id, latestPrice(costingData, id, ctx.costing.sourceOf));
      }
      return prices.get(id) ?? null;
    };

    const result = buildDishEconomics({
      companyId,
      currency: ctx.currency,
      period: { from: params.from ?? null, to: params.to ?? null },
      list: listRes.list,
      links: listRes.links,
      versions: ctx.versions,
      inputsByVersionId: ctx.inputsByVersionId,
      costing: costingData,
      asOfDate: params.asOfDate ?? null,
      evidenceLinesOf,
      priceOf,
      locationId: params.locationId ?? null,
      storedMenuDishes: ctx.storedMenuDishes.filter(
        (d) =>
          !d.restaurant_id ||
          !params.locationId ||
          d.restaurant_id === params.locationId
      ),
      storedVariants: storedVariantsFor(
        ctx.storedVariantRows,
        ctx.storedMenuDishes,
        params.locationId ?? null
      ),
    });
    result.menu_dishes_stored = ctx.menuDishesStored;
    result.item_groups = ctx.itemGroups;
    const ms = Date.now() - started;
    console.log(
      `[timing] dish-economics ${ms}ms dishes=${result.dishes.length} period=${params.from ?? "all"}..${params.to ?? "all"}`
    );
    return { ok: true, result, list: listRes.list, ms };
  } catch (err) {
    console.error("[dish-economics] failed:", err);
    return { ok: false, error: "No se pudieron calcular los costos." };
  }
}

/** Recipes, lines and prices: once per request and company. */
const loadDishCostContext = cache(async (companyId: string) => {
  const supabase = await createClient();
  return loadDishCostContextWith(supabase, companyId);
});

/**
 * Per-request cached loader for server components and routes: every
 * screen in one render shares one load (and one cost context across
 * periods). Args are primitives so React's cache() can key on them.
 */
export const loadDishEconomics = cache(
  async (
    companyId: string,
    from: string | null = null,
    to: string | null = null,
    locationId: string | null = null,
    odooProductId: number | null = null
  ): Promise<DishEconomicsLoad> => {
    const [supabase, context] = await Promise.all([
      createClient(),
      loadDishCostContext(companyId),
    ]);
    return loadDishEconomicsWith(
      supabase,
      { companyId, from, to, locationId, odooProductId },
      context.ok ? context.context : undefined
    );
  }
);
