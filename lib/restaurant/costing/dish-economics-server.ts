// lib/restaurant/costing/dish-economics-server.ts
//
// Loads what buildDishEconomics needs, once per request. Company id comes
// from auth, never from the request. Every query is company-scoped and
// runs through the caller's RLS-bound client.

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
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
  "id, menu_item_id, version_number, status, effective_date, approved_at, created_at";
const INPUT_SELECT =
  "id, recipe_version_id, input_type, ingredient_id, component_id, quantity, unit, unit_cost, cost_source";

/** Everything except the period's sales: recipes, lines and prices. */
export interface DishCostContext {
  versions: DishVersion[];
  inputsByVersionId: Map<string, VersionInput[]>;
  costing: CostingLoad;
  currency: string;
}

export async function loadDishCostContextWith(
  supabase: SupabaseClient,
  companyId: string
): Promise<
  { ok: true; context: DishCostContext } | { ok: false; error: string }
> {
  const [versionsRes, inputsRes, costing, currency] = await Promise.all([
    fetchAllRowsRetryingWithoutColumns<DishVersion>(
      ["approved_at"],
      (select) =>
        supabase
          .from("recipe_versions")
          .select(select)
          .eq("company_id", companyId),
      VERSION_SELECT
    ),
    fetchAllRowsRetryingWithoutColumns<Record<string, unknown>>(
      ["unit_cost", "cost_source"],
      (select) =>
        supabase
          .from("recipe_version_inputs")
          .select(select)
          .eq("company_id", companyId),
      INPUT_SELECT
    ),
    createSupabaseEditorStore(supabase).loadCosting(companyId),
    resolveCompanyCurrency(supabase, companyId),
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

    const prices = new Map<string, PriceMeta | null>();
    const priceOf = (id: string): PriceMeta | null => {
      if (!prices.has(id)) {
        prices.set(id, latestPrice(ctx.costing.data, id, ctx.costing.sourceOf));
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
      costing: ctx.costing.data,
      evidenceLinesOf,
      priceOf,
      locationId: params.locationId ?? null,
    });
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
