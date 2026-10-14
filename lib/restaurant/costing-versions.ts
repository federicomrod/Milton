import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CostingComponentRecipeVersion,
  CostingMenuRecipeVersion,
  CostingRecipeInput,
} from "@/lib/restaurant/costing";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import {
  fetchAllRows,
  succeededRows,
  type FetchAllRowsResult,
} from "@/lib/restaurant/paginated-read";

/** No query at all when skipped: an empty, successful result. */
function skipWhen<T>(
  skip: boolean | undefined,
  run: () => Promise<FetchAllRowsResult<T>>
): Promise<FetchAllRowsResult<T>> {
  return skip
    ? Promise.resolve<FetchAllRowsResult<T>>({
        rows: [],
        truncated: false,
        error: null,
      })
    : run();
}

/** Per-line cost columns from migration 043; read when they exist. */
const LINE_COST_COLUMNS = ["unit_cost"] as const;

export async function fetchCostingRecipeVersions(
  supabase: SupabaseClient,
  companyId: string,
  /**
   * componentsOnly: skip every dish version and its lines (the recipe
   * editor costs one dish's lines and only needs the preparations).
   */
  opts: { componentsOnly?: boolean } = {}
): Promise<{
  menuRecipeVersionsByMenuItemId: Map<string, CostingMenuRecipeVersion[]>;
  menuRecipeVersionInputsByVersionId: Map<string, CostingRecipeInput[]>;
  componentRecipeVersionsByComponentId: Map<
    string,
    CostingComponentRecipeVersion[]
  >;
  componentRecipeVersionInputsByVersionId: Map<string, CostingRecipeInput[]>;
  recipeVersionsError?: string;
  componentVersionsError?: string;
}> {
  const [
    recipeVersionsRes,
    recipeVersionInputsRes,
    componentVersionsRes,
    componentVersionInputsRes,
  ] = await Promise.all([
    skipWhen(opts.componentsOnly, () =>
      fetchAllRows<{
        id: string;
        recipe_id: string;
        menu_item_id: string;
        version_number: number;
        status: string;
        effective_date: string | null;
        source_type: string | null;
      }>(() =>
        supabase
          .from("recipe_versions")
          .select(
            "id, recipe_id, menu_item_id, version_number, status, effective_date, source_type"
          )
          .eq("company_id", companyId)
      )
    ),
    skipWhen(opts.componentsOnly, () =>
      fetchAllRowsRetryingWithoutColumns<{
        recipe_version_id: string;
        input_type: "ingredient" | "component";
        ingredient_id: string | null;
        component_id: string | null;
        quantity: number;
        unit: string;
        unit_cost?: number | null;
      }>(
        LINE_COST_COLUMNS,
        (select) =>
          supabase
            .from("recipe_version_inputs")
            .select(select)
            .eq("company_id", companyId),
        "recipe_version_id, input_type, ingredient_id, component_id, quantity, unit, unit_cost"
      )
    ),
    fetchAllRows<{
      id: string;
      component_recipe_id: string;
      component_id: string;
      version_number: number;
      status: string;
      effective_date: string | null;
      output_quantity: number;
      output_unit: string;
      source_type: string | null;
    }>(() =>
      supabase
        .from("component_recipe_versions")
        .select(
          "id, component_recipe_id, component_id, version_number, status, effective_date, output_quantity, output_unit, source_type"
        )
        .eq("company_id", companyId)
    ),
    fetchAllRowsRetryingWithoutColumns<{
      component_recipe_version_id: string;
      input_type: "ingredient" | "component";
      ingredient_id: string | null;
      component_id: string | null;
      quantity: number;
      unit: string;
      unit_cost?: number | null;
    }>(
      LINE_COST_COLUMNS,
      (select) =>
        supabase
          .from("component_recipe_version_inputs")
          .select(select)
          .eq("company_id", companyId),
      "component_recipe_version_id, input_type, ingredient_id, component_id, quantity, unit, unit_cost"
    ),
  ]);

  const menuRecipeVersionsByMenuItemId = new Map<
    string,
    CostingMenuRecipeVersion[]
  >();
  for (const row of succeededRows(recipeVersionsRes)) {
    const list = menuRecipeVersionsByMenuItemId.get(row.menu_item_id) ?? [];
    list.push({
      id: row.id,
      recipe_id: row.recipe_id,
      menu_item_id: row.menu_item_id,
      version_number: row.version_number,
      status: row.status,
      effective_date: row.effective_date,
      source_type: row.source_type,
    });
    menuRecipeVersionsByMenuItemId.set(row.menu_item_id, list);
  }
  const menuRecipeVersionInputsByVersionId = new Map<
    string,
    CostingRecipeInput[]
  >();
  for (const row of succeededRows(recipeVersionInputsRes)) {
    const list =
      menuRecipeVersionInputsByVersionId.get(row.recipe_version_id) ?? [];
    list.push({
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    });
    menuRecipeVersionInputsByVersionId.set(row.recipe_version_id, list);
  }
  const componentRecipeVersionsByComponentId = new Map<
    string,
    CostingComponentRecipeVersion[]
  >();
  for (const row of succeededRows(componentVersionsRes)) {
    const list =
      componentRecipeVersionsByComponentId.get(row.component_id) ?? [];
    list.push({
      id: row.id,
      component_recipe_id: row.component_recipe_id,
      component_id: row.component_id,
      version_number: row.version_number,
      status: row.status,
      effective_date: row.effective_date,
      output_quantity: row.output_quantity,
      output_unit: row.output_unit,
      source_type: row.source_type,
    });
    componentRecipeVersionsByComponentId.set(row.component_id, list);
  }
  const componentRecipeVersionInputsByVersionId = new Map<
    string,
    CostingRecipeInput[]
  >();
  for (const row of succeededRows(componentVersionInputsRes)) {
    const list =
      componentRecipeVersionInputsByVersionId.get(
        row.component_recipe_version_id
      ) ?? [];
    list.push({
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
      unit_cost: row.unit_cost == null ? null : Number(row.unit_cost),
    });
    componentRecipeVersionInputsByVersionId.set(
      row.component_recipe_version_id,
      list
    );
  }

  return {
    menuRecipeVersionsByMenuItemId,
    menuRecipeVersionInputsByVersionId,
    componentRecipeVersionsByComponentId,
    componentRecipeVersionInputsByVersionId,
    recipeVersionsError: recipeVersionsRes.error?.message,
    componentVersionsError: componentVersionsRes.error?.message,
  };
}
