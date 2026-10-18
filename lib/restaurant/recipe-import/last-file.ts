// A dish's recipe from the LAST uploaded cost file (the saved upload, read
// again; no re-upload). The dish page shows it side by side with the recipe
// the dish has now, and «Usar esta receta» adds it as a NEW draft version —
// the same write the import does (one undoable batch; old versions untouched).

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { loadUploadDraftFile } from "@/lib/restaurant/price-catalog/draft";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  loadEditor,
  refreshEvidence,
  withCachedCatalog,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { lineUnit, type ImportPlan, type PlannedDish } from "./plan";
import {
  loadAndPlan,
  writeImportPlan,
  type RecipeImportResult,
} from "./server";
import type { CanonicalRecipe, CanonicalWorkbook } from "./types";

export interface FileRecipeLine {
  name: string;
  quantity: number;
  unit: string;
  /** Null = Pendiente (never 0). */
  unit_cost: number | null;
  cost: number | null;
}

export interface CurrentRecipeLine {
  name: string;
  quantity: number;
  unit: string;
  cost: number | null;
}

export type LastFileLookup =
  | { available: false; reason: "no_file" | "not_in_file" }
  | {
      available: true;
      filename: string;
      recipe_key: string;
      recipe_name: string;
      file: { lines: FileRecipeLine[]; total: number | null };
      current: { lines: CurrentRecipeLine[]; total: number | null };
      /** The dish has no lines yet. */
      empty: boolean;
      /** Both have lines and they are not the same recipe. */
      differs: boolean;
    };

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function fileLines(recipe: CanonicalRecipe): FileRecipeLine[] {
  return recipe.lines
    .filter((line) => line.quantity && line.quantity > 0)
    .map((line) => ({
      name: line.ingredient_name.replace(/\s+/g, " ").trim(),
      quantity: line.quantity as number,
      unit: lineUnit(line),
      unit_cost: line.unit_cost,
      cost:
        line.unit_cost !== null
          ? Math.round((line.quantity as number) * line.unit_cost * 100) / 100
          : null,
    }));
}

/** Same items, quantities and units (order and spelling aside). */
export function sameRecipeLines(
  a: ReadonlyArray<{ name: string; quantity: number; unit: string }>,
  b: ReadonlyArray<{ name: string; quantity: number; unit: string }>
): boolean {
  const keyOf = (row: { name: string; quantity: number; unit: string }) =>
    `${normalizeMatchName(row.name)}|${round3(row.quantity)}|${row.unit
      .trim()
      .toLowerCase()}`;
  if (a.length !== b.length) return false;
  const left = a.map(keyOf).sort();
  const right = b.map(keyOf).sort();
  return left.every((key, index) => key === right[index]);
}

/** The file's dish for this POS product (the main menu before the events copy). */
export function dishForProduct(
  plan: ImportPlan,
  odooProductId: number
): PlannedDish | null {
  const hits = plan.dishes.filter((dish) =>
    dish.pos.some((product) => product.odoo_product_id === odooProductId)
  );
  return (
    hits.find((dish) => !dish.recipe.flags.includes("menu_eventos")) ??
    hits[0] ??
    null
  );
}

export async function lookupDishInLastFile(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    odooProductId: number;
    locationId: string | null;
  }
): Promise<LastFileLookup> {
  const stored = await loadUploadDraftFile(supabase, input.companyId);
  if (!stored) return { available: false, reason: "no_file" };
  const { plan } = await loadAndPlan(supabase, {
    companyId: input.companyId,
    buffer: stored.buffer,
    locationId: input.locationId,
  });
  const dish = dishForProduct(plan, input.odooProductId);
  if (!dish) return { available: false, reason: "not_in_file" };

  const lines = fileLines(dish.recipe);
  const total =
    dish.recipe.pending_lines > 0 ? null : dish.recipe.calculated_cost;
  const editor = await loadEditor({
    store: withCachedCatalog(createSupabaseEditorStore(supabase)),
    companyId: input.companyId,
    odooProductId: input.odooProductId,
    locationId: input.locationId,
    userId: null,
    omitOptions: true,
  }).catch(() => null);
  const current: CurrentRecipeLine[] =
    editor && editor.ok
      ? editor.state.lines.map((line) => ({
          name: line.name ?? line.raw_name,
          quantity: line.qty,
          unit: line.unit,
          cost: line.amount,
        }))
      : [];
  const currentTotal = editor && editor.ok ? editor.state.total_cost : null;
  return {
    available: true,
    filename: stored.filename,
    recipe_key: dish.recipe.key,
    recipe_name: dish.recipe.name,
    file: {
      lines,
      total: total === null ? null : Math.round(total * 100) / 100,
    },
    current: { lines: current, total: currentTotal },
    empty: current.length === 0,
    differs: current.length > 0 && !sameRecipeLines(current, lines),
  };
}

/** The dish, the preparations its lines use (nested too) and their ingredients. */
export function planForOneDish(
  plan: ImportPlan,
  workbook: CanonicalWorkbook,
  dish: PlannedDish
): { plan: ImportPlan; workbook: CanonicalWorkbook } {
  const recipes: CanonicalRecipe[] = [dish.recipe];
  const prepKeys = new Set<string>();
  const queue = [dish.recipe];
  while (queue.length > 0) {
    const recipe = queue.pop()!;
    for (const line of recipe.lines) {
      if (!line.preparation_key || prepKeys.has(line.preparation_key)) continue;
      prepKeys.add(line.preparation_key);
      const prep = plan.preparations.find(
        (row) => row.recipe.key === line.preparation_key
      );
      if (prep) {
        recipes.push(prep.recipe);
        queue.push(prep.recipe);
      }
    }
  }
  const ingredientKeys = new Set(
    recipes.flatMap((recipe) =>
      recipe.lines
        .filter((line) => !line.preparation_key)
        .map((line) => normalizeMatchName(line.ingredient_name))
    )
  );
  return {
    plan: {
      ...plan,
      ingredients: plan.ingredients.filter((row) =>
        ingredientKeys.has(row.key)
      ),
      preparations: plan.preparations.filter((row) =>
        prepKeys.has(row.recipe.key)
      ),
      dishes: [{ ...dish, conflict: null }],
    },
    workbook: { ...workbook, recipes },
  };
}

export async function applyDishFromLastFile(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    currency: string;
    odooProductId: number;
    locationId: string | null;
    recipeKey: string;
    createdBy: string | null;
  }
): Promise<RecipeImportResult | null> {
  const stored = await loadUploadDraftFile(supabase, input.companyId);
  if (!stored) return null;
  const { plan, workbook, repo } = await loadAndPlan(supabase, {
    companyId: input.companyId,
    buffer: stored.buffer,
    locationId: input.locationId,
  });
  const dish = dishForProduct(plan, input.odooProductId);
  if (!dish || dish.recipe.key !== input.recipeKey) return null;
  const one = planForOneDish(plan, workbook, dish);
  const { result, linked } = await writeImportPlan({
    repo,
    plan: one.plan,
    workbook: one.workbook,
    companyId: input.companyId,
    currency: input.currency,
    filename: stored.filename,
    createdBy: input.createdBy,
    locationId: input.locationId,
    // The person asked for this dish's recipe from the file: a new draft
    // version even if the dish has its own recipe (the old versions stay).
    choices: { [dish.recipe.key]: "excel" },
    insertCanonicalRows: async (rows) => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("recipe_canonical_lines")
          .insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
    },
  });
  const store = withCachedCatalog(createSupabaseEditorStore(supabase));
  for (const odooProductId of linked) {
    try {
      await refreshEvidence({
        store,
        companyId: input.companyId,
        odooProductId,
        locationId: input.locationId,
        userId: input.createdBy,
      });
    } catch (err) {
      console.error("[last-file refresh]", err);
    }
  }
  return result;
}
