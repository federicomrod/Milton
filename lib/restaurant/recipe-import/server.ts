// Recipe import from the cost file: translate → canonical table → plan →
// (on "Importar") write. Company comes from auth, never from the request.
// The whole import is one batch: "Deshacer lote" removes everything it
// created, the canonical rows included.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseCostWorkbookRepo,
  type CostWorkbookRepo,
} from "@/lib/restaurant/cost-workbook/repo";
import { pickMenuItemForLocation } from "@/lib/restaurant/cost-workbook/menu-item-pick";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import {
  emptyUndoSnapshot,
  type RecipeInputSnapshot,
} from "@/lib/restaurant/cost-workbook/types";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import {
  suggestPosProductLink,
  unlinkedPosProduct,
} from "@/lib/restaurant/pos-product-links";
import { isImportProtectedSource } from "@/lib/restaurant/protect-imported-recipe";
import {
  hasApprovedVersion,
  nextVersionNumber,
} from "@/lib/restaurant/recipe-versions";
import { posPriceFromSales } from "@/lib/restaurant/recipe-costing/display";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import {
  refreshEvidence,
  withCachedCatalog,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  excelPriceWithIva,
  lineUnit,
  planImport,
  type ImportPlan,
  type PlanPosProduct,
} from "./plan";
import { translateCostWorkbookBuffer } from "./translate";
import { readCatalogFromBuffer } from "@/lib/restaurant/price-catalog/server";
import {
  EXCEL_IMPORT_SOURCE,
  type CanonicalLine,
  type CanonicalRecipe,
  type CanonicalWorkbook,
} from "./types";

export const EXCEL_IMPORT_NOTES = "Importada del Excel";

/** "Churrasco Típico (6 onz.) (Pan con Ajo)" → "Churrasco Típico (6 onz.)". */
function posBaseLabel(name: string): string {
  const first = name.match(/^[^(]*(\([^)]*\d[^)]*\))?/);
  return (first?.[0] ?? name).replace(/\s+/g, " ").trim() || name;
}

export class RecipeImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecipeImportError";
  }
}

export const NEEDS_043 =
  "Falta aplicar la migración 043 en Supabase antes de importar las recetas.";

interface Loaded {
  workbook: CanonicalWorkbook;
  plan: ImportPlan;
  repo: CostWorkbookRepo;
}

async function loadAndPlan(
  supabase: SupabaseClient,
  input: { companyId: string; buffer: Buffer; locationId: string | null }
): Promise<Loaded> {
  const workbook = translateCostWorkbookBuffer(input.buffer);
  if (!workbook.recipes.some((recipe) => recipe.kind === "dish")) {
    throw new RecipeImportError(
      "No encontré recetas de platos en este archivo (bloques con Articulo, Cantidad, Costo Unitario)."
    );
  }
  const repo = createSupabaseCostWorkbookRepo(supabase);
  const [list, ingredients, components, menuItems, recipes, links] =
    await Promise.all([
      loadPosProductList(supabase, {
        companyId: input.companyId,
        locationId: input.locationId,
      }),
      repo.listIngredients(input.companyId),
      repo.listComponents(input.companyId),
      repo.listMenuItems(input.companyId),
      repo.listRecipes(input.companyId),
      repo.listPosProductLinks(input.companyId, input.locationId),
    ]);
  if (!list.ok) throw new Error(list.error);
  const aliases = new Map<string, string>();
  try {
    for (const row of await repo.listIngredientAliases(input.companyId)) {
      aliases.set(normalizeMatchName(row.alias_name), row.ingredient_id);
    }
  } catch {
    // nothing remembered
  }

  const menuById = new Map(menuItems.map((row) => [row.id, row]));
  const recipeByMenu = new Map(recipes.map((row) => [row.menu_item_id, row]));
  const products: PlanPosProduct[] = [];
  const existing: Array<{ odoo_product_id: number; protected: boolean }> = [];
  for (const product of list.list.products) {
    if (product.is_combo) continue;
    const link = links.find(
      (row) =>
        row.odoo_product_id === product.odoo_product_id &&
        (row.location_id === input.locationId || row.location_id == null)
    );
    const menu = link?.menu_item_id
      ? menuById.get(link.menu_item_id)
      : undefined;
    const sellingPrice =
      menu?.selling_price && menu.selling_price > 0 ? menu.selling_price : null;
    products.push({
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      pos_price:
        sellingPrice ??
        posPriceFromSales(product.net_sales, product.units_sold),
      link_state: link?.link_state ?? product.link_state,
    });
    const recipe = menu ? recipeByMenu.get(menu.id) : undefined;
    if (recipe) {
      const versions = await repo.listRecipeVersions(
        input.companyId,
        recipe.id
      );
      existing.push({
        odoo_product_id: product.odoo_product_id,
        protected:
          isImportProtectedSource(recipe.source_type) ||
          hasApprovedVersion(versions),
      });
    }
  }

  // The price list of the same file: its unit becomes a new ingredient's
  // unit, so saving the list later never fails to convert.
  const listUnits = new Map<string, string>();
  try {
    const { read } = readCatalogFromBuffer(input.buffer);
    for (const row of read?.rows ?? []) {
      if (row.kind === "ingredient" && row.unit && row.status === "ok") {
        listUnits.set(normalizeMatchName(row.name), row.unit);
      }
    }
  } catch {
    // No readable price list: units come from the recipe lines.
  }
  const plan = planImport({
    workbook,
    catalog: {
      ingredients: ingredients.map((row) => ({ id: row.id, name: row.name })),
      preparations: components.map((row) => ({ id: row.id, name: row.name })),
      aliases,
      listUnits,
    },
    products,
    existing,
  });
  return { workbook, plan, repo };
}

export async function previewRecipeImport(
  supabase: SupabaseClient,
  input: { companyId: string; buffer: Buffer; locationId?: string | null }
) {
  const { workbook, plan } = await loadAndPlan(supabase, {
    ...input,
    locationId: input.locationId ?? null,
  });
  return { ok: true as const, tabs: workbook.tabs, ...plan.preview };
}

/** Migration 043 must be there before anything is written. */
async function assertSchema(supabase: SupabaseClient): Promise<void> {
  const canonical = await supabase
    .from("recipe_canonical_lines")
    .select("id", { head: true, count: "exact" })
    .limit(1);
  const lineCost = await supabase
    .from("recipe_version_inputs")
    .select("unit_cost", { head: true, count: "exact" })
    .limit(1);
  if (canonical.error || lineCost.error) throw new RecipeImportError(NEEDS_043);
}

function inputsFor(
  recipe: CanonicalRecipe,
  ids: {
    ingredient: (line: CanonicalLine) => string | null;
    preparation: (key: string) => string | null;
  }
): RecipeInputSnapshot[] {
  const inputs: RecipeInputSnapshot[] = [];
  for (const line of recipe.lines) {
    // A line needs a quantity to be a recipe line; the rest stays in the
    // canonical table and in the dish's evidence, flagged.
    if (!line.quantity || line.quantity <= 0) continue;
    const componentId = line.preparation_key
      ? ids.preparation(line.preparation_key)
      : null;
    const ingredientId = componentId ? null : ids.ingredient(line);
    if (!componentId && !ingredientId) continue;
    inputs.push({
      input_type: componentId ? "component" : "ingredient",
      ingredient_id: ingredientId,
      component_id: componentId,
      quantity: line.quantity,
      unit: lineUnit(line),
      notes: null,
      unit_cost: line.unit_cost,
      cost_source: `${line.source_tab.trim()}!${line.source_cell}`,
    });
  }
  return inputs;
}

function evidenceFor(
  recipe: CanonicalRecipe,
  filename: string,
  names: {
    preparation: (key: string) => string | null;
    ingredient: (line: CanonicalLine) => string;
  }
): Record<string, unknown> {
  return {
    source: EXCEL_IMPORT_SOURCE,
    tab: recipe.source_tab.trim(),
    block_name: recipe.name,
    filename,
    confidence: 1,
    evidence: `Receta del Excel: ${recipe.source_tab.trim()} › ${recipe.source_cell}`,
    yield: { value: 1, unit: "portion", source: "excel" },
    excel_total: recipe.excel_total_cost,
    milton_cost: null,
    excel_match: null,
    status: "borrador",
    pending: recipe.pending_lines > 0,
    reasons: [],
    lines: recipe.lines.map((line) => {
      const prep = line.preparation_key
        ? names.preparation(line.preparation_key)
        : null;
      const pending =
        line.unit_cost === null || !line.quantity || line.quantity <= 0;
      return {
        source_row: Number(line.source_cell.replace(/^[A-Z]+/, "")),
        raw_name: line.ingredient_name,
        ingredient_match: prep ? null : names.ingredient(line),
        sub_recipe_match: prep,
        qty: line.quantity ?? 0,
        unit: lineUnit(line),
        unit_cost: line.unit_cost,
        excel_unit_cost: line.unit_cost,
        flags: [...line.flags, ...(pending ? ["pendiente_costo"] : [])],
        pending,
        reasons: [],
      };
    }),
  };
}

export interface RecipeImportResult {
  ok: true;
  batch_id: string;
  dishes_imported: number;
  dishes_linked: number;
  /** POS products linked (a dish sold with different sides is several). */
  pos_products_linked: number;
  dishes_skipped: number;
  preparations_created: number;
  /** Existing draft preparations that got the file's sub-recipe. */
  preparations_updated: number;
  ingredients_created: number;
  canonical_rows: number;
}

export async function applyRecipeImport(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    currency: string;
    buffer: Buffer;
    filename: string;
    createdBy?: string | null;
    locationId?: string | null;
  }
): Promise<RecipeImportResult> {
  await assertSchema(supabase);
  const locationId = input.locationId ?? null;
  const { plan, workbook, repo } = await loadAndPlan(supabase, {
    companyId: input.companyId,
    buffer: input.buffer,
    locationId,
  });
  const { result, linked } = await writeImportPlan({
    repo,
    plan,
    workbook,
    companyId: input.companyId,
    currency: input.currency,
    filename: input.filename,
    createdBy: input.createdBy ?? null,
    locationId,
    insertCanonicalRows: async (rows) => {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("recipe_canonical_lines")
          .insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
    },
  });

  // Cost the linked drafts so Plato por plato opens with the totals.
  const store = withCachedCatalog(createSupabaseEditorStore(supabase));
  for (const odooProductId of linked) {
    try {
      await refreshEvidence({
        store,
        companyId: input.companyId,
        odooProductId,
        locationId,
        userId: input.createdBy ?? null,
      });
    } catch (err) {
      console.error("[recipe-import refresh]", err);
    }
  }
  return result;
}

/**
 * Write an import plan as one batch. Takes the repository (and how to
 * store canonical rows) so the rules can be checked without a database.
 */
export async function writeImportPlan(input: {
  repo: CostWorkbookRepo;
  plan: ImportPlan;
  workbook: CanonicalWorkbook;
  companyId: string;
  currency: string;
  filename: string;
  createdBy: string | null;
  locationId: string | null;
  insertCanonicalRows: (rows: Array<Record<string, unknown>>) => Promise<void>;
}): Promise<{ result: RecipeImportResult; linked: number[] }> {
  const { repo, plan, workbook, locationId } = input;
  const batch = await repo.createBatch({
    companyId: input.companyId,
    filename: `${input.filename} · recetas`,
    fileMonth: null,
    currency: input.currency,
    importedCount: plan.dishes.length,
    reviewCount: 0,
    tabSummaries: [],
    // Read by plain code, no AI and no saved layout.
    mappingSource: "mixed",
    createdBy: input.createdBy ?? null,
  });
  const changes = emptyUndoSnapshot();
  changes.recipe_import = true;
  const result: RecipeImportResult = {
    ok: true,
    batch_id: batch.id,
    dishes_imported: 0,
    dishes_linked: 0,
    pos_products_linked: 0,
    dishes_skipped: 0,
    preparations_created: 0,
    preparations_updated: 0,
    ingredients_created: 0,
    canonical_rows: 0,
  };

  const linked: number[] = [];
  try {
    // 1. Ingredients: one record per name.
    const ingredientIds = new Map<string, string>();
    for (const row of plan.ingredients) {
      if (row.existing_id) ingredientIds.set(row.key, row.existing_id);
    }
    const toCreate = plan.ingredients.filter((row) => !row.existing_id);
    for (let i = 0; i < toCreate.length; i += 100) {
      const chunk = toCreate.slice(i, i + 100);
      const created = await repo.createIngredients(
        chunk.map((row) => ({
          companyId: input.companyId,
          name: row.name,
          defaultUnit: row.default_unit,
          currentUnitCost: null,
          currency: input.currency,
        }))
      );
      for (const row of created) {
        ingredientIds.set(normalizeMatchName(row.name), row.id);
        changes.created_ingredient_ids.push(row.id);
      }
    }
    result.ingredients_created = changes.created_ingredient_ids.length;
    const ingredientId = (line: CanonicalLine) =>
      ingredientIds.get(normalizeMatchName(line.ingredient_name)) ?? null;
    // The name the editor matches lines on: the catalog's own spelling
    // when an existing ingredient was reused.
    const ingredientNames = new Map(
      plan.ingredients.map((row) => [row.key, row.existing_name ?? row.name])
    );
    const ingredientName = (line: CanonicalLine) =>
      ingredientNames.get(normalizeMatchName(line.ingredient_name)) ??
      line.ingredient_name;

    // 2. Preparations: every component first, so nested ones resolve.
    const prepIds = new Map<string, string>();
    const prepNames = new Map<string, string>();
    for (const prep of plan.preparations) {
      prepNames.set(prep.recipe.key, prep.recipe.name);
      if (prep.existing_id) {
        prepIds.set(prep.recipe.key, prep.existing_id);
        continue;
      }
      const component = await repo.createComponent({
        companyId: input.companyId,
        name: prep.recipe.name,
        outputUnit: prep.recipe.output?.unit ?? "orden",
        sourceId: batch.id,
      });
      changes.created_component_ids.push(component.id);
      prepIds.set(prep.recipe.key, component.id);
    }
    const preparationId = (key: string) => prepIds.get(key) ?? null;
    const [existingComponents, existingComponentRecipes] = await Promise.all([
      repo.listComponents(input.companyId),
      repo.listComponentRecipes(input.companyId),
    ]);
    for (const prep of plan.preparations) {
      const componentId = prepIds.get(prep.recipe.key)!;
      const output = prep.recipe.output ?? { quantity: 1, unit: "orden" };
      const inputs = inputsFor(prep.recipe, {
        ingredient: ingredientId,
        preparation: preparationId,
      });
      if (prep.existing_id) {
        // An existing preparation gets the file's sub-recipe as a new draft
        // only when nobody made it by hand or approved it (for example a
        // draft an earlier suggestion run left with an assumed yield).
        const component = existingComponents.find(
          (row) => row.id === componentId
        );
        const componentRecipe = existingComponentRecipes.find(
          (row) => row.component_id === componentId
        );
        if (!component || isImportProtectedSource(component.source_type))
          continue;
        if (
          !componentRecipe ||
          isImportProtectedSource(componentRecipe.source_type)
        ) {
          continue;
        }
        const versions = await repo.listComponentRecipeVersions(
          input.companyId,
          componentRecipe.id
        );
        if (versions.some((row) => row.status === "approved")) continue;
        const version = await repo.insertComponentRecipeVersion({
          companyId: input.companyId,
          componentRecipeId: componentRecipe.id,
          componentId,
          versionNumber:
            Math.max(0, ...versions.map((row) => row.version_number)) + 1,
          status: "in_review",
          effectiveDate: null,
          outputQuantity: output.quantity,
          outputUnit: output.unit,
          sourceType: "import",
          inputs,
        });
        changes.created_component_recipe_version_ids = [
          ...(changes.created_component_recipe_version_ids ?? []),
          version.id,
        ];
        result.preparations_updated += 1;
        continue;
      }
      const componentRecipe = await repo.createComponentRecipe({
        companyId: input.companyId,
        componentId,
        name: prep.recipe.name,
        outputQuantity: output.quantity,
        outputUnit: output.unit,
        sourceId: batch.id,
        inputs: [],
      });
      changes.created_component_recipe_ids.push(componentRecipe.id);
      const version = await repo.insertComponentRecipeVersion({
        companyId: input.companyId,
        componentRecipeId: componentRecipe.id,
        componentId,
        versionNumber: 1,
        status: "in_review",
        effectiveDate: null,
        outputQuantity: output.quantity,
        outputUnit: output.unit,
        sourceType: "import",
        inputs,
      });
      changes.created_component_recipe_version_ids = [
        ...(changes.created_component_recipe_version_ids ?? []),
        version.id,
      ];
      result.preparations_created += 1;
    }

    // 3. Dishes: a draft version each, linked when the POS match is sure.
    const [menuItems, recipes, links] = await Promise.all([
      repo.listMenuItems(input.companyId),
      repo.listRecipes(input.companyId),
      repo.listPosProductLinks(input.companyId, locationId),
    ]);
    const recipeByMenu = new Map(recipes.map((row) => [row.menu_item_id, row]));
    for (const dish of plan.dishes) {
      if (dish.skip_reason) {
        result.dishes_skipped += 1;
        continue;
      }
      const recipe = dish.recipe;
      const linkOf = (odooProductId: number) =>
        links.find(
          (row) =>
            row.odoo_product_id === odooProductId &&
            (row.location_id === locationId || row.location_id == null)
        );
      // One menu item (and one recipe) for every POS variant of the dish:
      // the one a variant already points at, else the dish's own name.
      const linkedMenuId = dish.pos
        .map((product) => linkOf(product.odoo_product_id)?.menu_item_id)
        .find((id): id is string => Boolean(id));
      let menuItem =
        (linkedMenuId
          ? menuItems.find((row) => row.id === linkedMenuId)
          : undefined) ??
        pickMenuItemForLocation(
          menuItems,
          dish.pos[0]?.odoo_name ?? recipe.name,
          locationId
        ) ??
        pickMenuItemForLocation(menuItems, recipe.name, locationId);
      if (!menuItem) {
        menuItem = await repo.createMenuItem({
          companyId: input.companyId,
          name: dish.pos[0] ? posBaseLabel(dish.pos[0].odoo_name) : recipe.name,
          currency: input.currency,
          sourceId: batch.id,
          locationId,
          sellingPrice: dish.pos[0]?.pos_price ?? excelPriceWithIva(recipe),
        });
        changes.created_menu_item_ids.push(menuItem.id);
        menuItems.push(menuItem);
      }
      let recipeRow = recipeByMenu.get(menuItem.id);
      if (recipeRow && isImportProtectedSource(recipeRow.source_type)) {
        result.dishes_skipped += 1;
        continue;
      }
      if (!recipeRow) {
        recipeRow = await repo.createRecipe({
          companyId: input.companyId,
          menuItemId: menuItem.id,
          name: menuItem.name,
          sourceId: batch.id,
          inputs: [],
        });
        changes.created_recipe_ids.push(recipeRow.id);
        recipeByMenu.set(menuItem.id, recipeRow);
      }
      const versions = await repo.listRecipeVersions(
        input.companyId,
        recipeRow.id
      );
      if (hasApprovedVersion(versions)) {
        result.dishes_skipped += 1;
        continue;
      }
      const version = await repo.insertRecipeVersion({
        companyId: input.companyId,
        recipeId: recipeRow.id,
        menuItemId: menuItem.id,
        versionNumber: nextVersionNumber(versions),
        status: "in_review",
        effectiveDate: null,
        sourceType: "import",
        notes: EXCEL_IMPORT_NOTES,
        inputs: inputsFor(recipe, {
          ingredient: ingredientId,
          preparation: preparationId,
        }),
      });
      changes.created_recipe_version_ids = [
        ...(changes.created_recipe_version_ids ?? []),
        version.id,
      ];
      result.dishes_imported += 1;

      let linkedHere = 0;
      for (const product of dish.pos) {
        const link = linkOf(product.odoo_product_id);
        // A person's Confirmado link is never changed.
        if (link?.link_state === "confirmado") continue;
        const base =
          link ??
          unlinkedPosProduct({
            company_id: input.companyId,
            odoo_product_id: product.odoo_product_id,
            odoo_name: product.odoo_name,
            location_id: locationId,
          });
        const saved = await repo.upsertPosProductLink(
          input.companyId,
          suggestPosProductLink(base, {
            menu_item_id: menuItem.id,
            evidence: {
              ...evidenceFor(recipe, input.filename, {
                preparation: (key) => prepNames.get(key) ?? null,
                ingredient: ingredientName,
              }),
              recipe_version_id: version.id,
            },
          })
        );
        if (saved.created) {
          changes.created_pos_product_link_ids = [
            ...(changes.created_pos_product_link_ids ?? []),
            saved.id,
          ];
        } else if (saved.before) {
          changes.updated_pos_product_links = [
            ...(changes.updated_pos_product_links ?? []),
            { id: saved.id, before: saved.before },
          ];
        }
        linked.push(product.odoo_product_id);
        linkedHere += 1;
      }
      if (linkedHere > 0) result.dishes_linked += 1;
      result.pos_products_linked += linkedHere;
    }

    // 4. The canonical rows of this import (the one table Milton reads).
    const rows = workbook.recipes.flatMap((recipe) =>
      recipe.lines.map((line, index) => ({
        company_id: input.companyId,
        batch_id: batch.id,
        source_file: input.filename,
        recipe_key: recipe.key,
        recipe_kind: recipe.kind,
        dish_name: recipe.kind === "dish" ? recipe.dish_name : recipe.name,
        size: recipe.size,
        ingredient_name: line.ingredient_name,
        unit: line.unit,
        quantity: line.quantity,
        unit_cost: line.unit_cost,
        line_total: line.line_total,
        excel_total_cost: recipe.excel_total_cost,
        excel_price_sin_iva: recipe.excel_price_sin_iva,
        source_tab: line.source_tab.trim(),
        source_cell: line.source_cell,
        flags: [...new Set([...line.flags, ...recipe.flags])],
        preparation_key: line.preparation_key,
        line_index: index,
      }))
    );
    await input.insertCanonicalRows(rows);
    result.canonical_rows = rows.length;
  } finally {
    await repo.updateBatchSnapshot(input.companyId, batch.id, changes);
  }
  return { result, linked };
}
