// "Leer menú (opcional)": read the restaurant's menu once, then leave a
// Sugerido draft for every POS dish that has no recipe yet. Company comes
// from auth, never from the request. Every write goes into one batch, so
// "Deshacer lote" and "Empezar de nuevo" remove it like an Excel run.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { pickMenuItemForLocation } from "@/lib/restaurant/cost-workbook/menu-item-pick";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import {
  unlinkedPosProduct,
  withMenuDraftEvidence,
} from "@/lib/restaurant/pos-product-links";
import { hasRecipe } from "@/lib/restaurant/recipe-costing/has-recipe";
import { loadVersionLineCounts } from "@/lib/restaurant/recipe-costing/has-recipe-server";
import { nextVersionNumber } from "@/lib/restaurant/recipe-versions";
import { wantsSuggestion } from "@/lib/restaurant/recipe-suggestion-server";
import { posPriceFromSales } from "@/lib/restaurant/recipe-costing/display";
import {
  asRecord,
  isBoundSuggestion,
  parseSuggestionEvidence,
} from "@/lib/restaurant/recipe-costing/evidence";
import {
  MENU_AI_MODEL,
  createOpenAiMenuReader,
  extractMenuDishes,
  parseMenuDishes,
  type MenuAi,
  type MenuDish,
} from "./extract";
import {
  MENU_EVIDENCE_SOURCE,
  decisionsByPlato,
  planMenuDrafts,
  type MenuDraftProduct,
} from "./drafts";
import { stripSize } from "./match";
import {
  MenuFetchError,
  readMenuSource,
  type MenuSource,
  type MenuText,
} from "./sources";

export class MenuReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MenuReadError";
  }
}

export interface MenuReadResult {
  ok: true;
  batch_id: string | null;
  menu_source_id: string | null;
  /** True when this menu was read before and the AI was not called again. */
  cached: boolean;
  truncated: boolean;
  /** Platos the menu lists. */
  dishes_read: number;
  /** Counts below are PLATOS, never POS products (sizes count once). */
  drafted: number;
  skipped_has_recipe: number;
  skipped_no_ingredients: number;
  skipped_draft_exists: number;
  /** Platos sin receta that the menu does not list. */
  not_on_menu: number;
  failed: number;
  new_components: number;
  /** Names of the platos in `not_on_menu` (kept for older readers). */
  not_found: string[];
  skipped: Array<{
    odoo_name: string;
    reason: string;
    code?: "has_recipe" | "no_ingredients" | "draft_exists" | "failed";
  }>;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Read the menu, or reuse the last reading of the same text. */
async function loadOrReadDishes(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    menu: MenuText;
    ai: MenuAi;
    createdBy: string | null;
  }
): Promise<{ id: string | null; dishes: MenuDish[]; cached: boolean }> {
  const contentHash = hashText(input.menu.text);
  const { data: existing } = await supabase
    .from("restaurant_menu_sources")
    .select("id, dishes")
    .eq("company_id", input.companyId)
    .eq("content_hash", contentHash)
    .maybeSingle();
  if (existing) {
    const dishes = parseMenuDishes({ dishes: existing.dishes });
    if (dishes.length > 0) {
      return { id: String(existing.id), dishes, cached: true };
    }
  }

  const dishes = await extractMenuDishes(input.menu.text, input.ai);
  if (dishes.length === 0) return { id: null, dishes, cached: false };
  const { data: saved, error } = await supabase
    .from("restaurant_menu_sources")
    .upsert(
      {
        company_id: input.companyId,
        kind: input.menu.kind,
        source_ref: input.menu.source_ref,
        content_hash: contentHash,
        menu_text: input.menu.text,
        dishes,
        model: MENU_AI_MODEL,
        created_by: input.createdBy,
      },
      { onConflict: "company_id,content_hash" }
    )
    .select("id")
    .single();
  if (error) {
    // The drafts still work without the cache; the next run reads again.
    console.error("[menu-reading cache]", error.message);
    return { id: null, dishes, cached: false };
  }
  return { id: String(saved.id), dishes, cached: false };
}

function batchName(menu: MenuText): string {
  if (menu.source_ref) {
    try {
      return `Menú · ${new URL(menu.source_ref).hostname}`;
    } catch {
      // fall through
    }
  }
  return "Menú · texto pegado";
}

export async function readMenuIntoDrafts(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    currency: string;
    source: MenuSource;
    createdBy?: string | null;
    locationId?: string | null;
    ai?: MenuAi;
    readSource?: typeof readMenuSource;
  }
): Promise<MenuReadResult> {
  const locationId = params.locationId ?? null;
  let menu: MenuText;
  try {
    menu = await (params.readSource ?? readMenuSource)(params.source);
  } catch (err) {
    if (err instanceof MenuFetchError) throw new MenuReadError(err.message);
    throw err;
  }

  const read = await loadOrReadDishes(supabase, {
    companyId: params.companyId,
    menu,
    ai: params.ai ?? createOpenAiMenuReader(),
    createdBy: params.createdBy ?? null,
  });
  if (read.dishes.length === 0) {
    throw new MenuReadError(
      "No encontré platos en ese menú. Revisa la dirección o pega el texto del menú."
    );
  }

  const list = await loadPosProductList(supabase, {
    companyId: params.companyId,
    locationId,
  });
  if (!list.ok) throw new Error(list.error);
  const products = list.list.products.filter(wantsSuggestion);

  const repo = createSupabaseCostWorkbookRepo(supabase);
  const [ingredients, components, menuItems, recipes, links] =
    await Promise.all([
      repo.listIngredients(params.companyId),
      repo.listComponents(params.companyId),
      repo.listMenuItems(params.companyId),
      repo.listRecipes(params.companyId),
      repo.listPosProductLinks(params.companyId, locationId),
    ]);
  const aliases = new Map<string, string>();
  try {
    for (const row of await repo.listIngredientAliases(params.companyId)) {
      aliases.set(normalizeMatchName(row.alias_name), row.ingredient_id);
    }
  } catch {
    // nothing remembered
  }
  const recipeByMenuId = new Map(recipes.map((row) => [row.menu_item_id, row]));
  const versionsByRecipe = new Map(
    await Promise.all(
      recipes.map(
        async (recipe) =>
          [
            recipe.id,
            await repo.listRecipeVersions(params.companyId, recipe.id),
          ] as const
      )
    )
  );

  const lineCounts = await loadVersionLineCounts(
    supabase,
    params.companyId,
    [...versionsByRecipe.values()].flat().map((version) => version.id)
  );

  const linkOf = (odooProductId: number) =>
    links.find(
      (link) =>
        link.odoo_product_id === odooProductId &&
        (link.location_id === locationId || link.location_id == null)
    );
  const menuItemOf = (odooProductId: number, odooName: string) => {
    const link = linkOf(odooProductId);
    return (
      (link?.menu_item_id
        ? menuItems.find((row) => row.id === link.menu_item_id)
        : undefined) ?? pickMenuItemForLocation(menuItems, odooName, locationId)
    );
  };

  const draftProducts: MenuDraftProduct[] = products.map((product) => {
    const link = linkOf(product.odoo_product_id);
    const evidence = parseSuggestionEvidence(asRecord(link?.evidence));
    const menuItem = menuItemOf(product.odoo_product_id, product.odoo_name);
    const recipe = menuItem ? recipeByMenuId.get(menuItem.id) : undefined;
    const versions = recipe ? (versionsByRecipe.get(recipe.id) ?? []) : [];
    return {
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      pos_price: posPriceFromSales(product.net_sales, product.units_sold),
      link_state: link?.link_state ?? product.link_state,
      // The same rule Menú › Platos uses for «Sin receta»: a version row with
      // no lines, or a Confirmado link, is not a recipe.
      has_recipe: hasRecipe({
        versions,
        lineCounts,
        boundSuggestion: isBoundSuggestion(evidence),
      }),
      menu_draft: evidence.source === MENU_EVIDENCE_SOURCE,
      plato_key: menuItem
        ? `item:${menuItem.id}`
        : `name:${normalizeMatchName(stripSize(product.odoo_name))}`,
    };
  });

  const decisions = decisionsByPlato(
    planMenuDrafts({
      products: draftProducts,
      dishes: read.dishes,
      catalog: {
        ingredients: ingredients.map((row) => ({
          id: row.id,
          name: row.name,
          default_unit: row.default_unit ?? null,
        })),
        preparations: components.map((row) => ({ id: row.id, name: row.name })),
        aliases,
      },
      menuSourceId: read.id,
      menuUrl: menu.source_ref,
    })
  );

  const result: MenuReadResult = {
    ok: true,
    batch_id: null,
    menu_source_id: read.id,
    cached: read.cached,
    truncated: menu.truncated,
    dishes_read: read.dishes.length,
    drafted: 0,
    skipped_has_recipe: 0,
    skipped_no_ingredients: 0,
    skipped_draft_exists: 0,
    not_on_menu: 0,
    failed: 0,
    new_components: 0,
    not_found: [],
    skipped: [],
  };
  for (const decision of decisions) {
    if (decision.kind === "no_encontrado") {
      result.not_found.push(decision.product.odoo_name);
      result.not_on_menu += 1;
    } else if (decision.kind === "omitido") {
      if (decision.code === "has_recipe") result.skipped_has_recipe += 1;
      else if (decision.code === "no_ingredients") {
        result.skipped_no_ingredients += 1;
      } else result.skipped_draft_exists += 1;
      result.skipped.push({
        odoo_name: decision.product.odoo_name,
        reason: decision.reason,
        code: decision.code,
      });
    }
  }
  const drafts = decisions.filter((d) => d.kind === "draft");
  if (drafts.length === 0) return result;

  const batch = await repo.createBatch({
    companyId: params.companyId,
    filename: batchName(menu),
    fileMonth: null,
    currency: params.currency,
    importedCount: 0,
    reviewCount: 0,
    tabSummaries: [],
    mappingSource: "ai",
    createdBy: params.createdBy ?? null,
  });
  result.batch_id = batch.id;
  const changes = emptyUndoSnapshot();

  try {
    for (const draft of drafts) {
      const { product } = draft;
      try {
        let menuItem = menuItemOf(product.odoo_product_id, product.odoo_name);
        if (!menuItem) {
          menuItem = await repo.createMenuItem({
            companyId: params.companyId,
            name: product.odoo_name,
            currency: params.currency,
            sourceId: batch.id,
            locationId,
            // The POS price when known. Unknown stays unknown: the column
            // is NOT NULL, so the repo stores 0, which the cockpit reads
            // as "Sin precio en el POS" (never as a real $0 price).
            sellingPrice: product.pos_price,
          });
          changes.created_menu_item_ids.push(menuItem.id);
          menuItems.push(menuItem);
        }
        let recipe = recipeByMenuId.get(menuItem.id);
        if (!recipe) {
          recipe = await repo.createRecipe({
            companyId: params.companyId,
            menuItemId: menuItem.id,
            name: product.odoo_name,
            sourceId: batch.id,
            inputs: [],
          });
          changes.created_recipe_ids.push(recipe.id);
          recipeByMenuId.set(menuItem.id, recipe);
        }
        // No lines yet: a line needs a quantity, and only a person writes it.
        const version = await repo.insertRecipeVersion({
          companyId: params.companyId,
          recipeId: recipe.id,
          menuItemId: menuItem.id,
          versionNumber: nextVersionNumber(
            await repo.listRecipeVersions(params.companyId, recipe.id)
          ),
          status: "in_review",
          effectiveDate: null,
          sourceType: "import",
          notes: "Borrador desde el menú",
          inputs: [],
        });
        changes.created_recipe_version_ids = [
          ...(changes.created_recipe_version_ids ?? []),
          version.id,
        ];

        const base =
          linkOf(product.odoo_product_id) ??
          unlinkedPosProduct({
            company_id: params.companyId,
            odoo_product_id: product.odoo_product_id,
            odoo_name: product.odoo_name,
            location_id: locationId,
          });
        const next = withMenuDraftEvidence(base, {
          menu_item_id: menuItem.id,
          evidence: { ...draft.evidence, recipe_version_id: version.id },
        });
        if (base.link_state === "confirmado") {
          // A Confirmado link stays exactly as it is (state, plato, who/when/
          // how): only the draft evidence is written, and undo restores the
          // whole row from this snapshot.
          if (!base.id || base.menu_item_id !== menuItem.id) {
            throw new Error("confirmed link points elsewhere");
          }
          const before = structuredClone(base);
          await repo.updatePosProductLinkEvidence(
            params.companyId,
            base.id,
            next.evidence
          );
          changes.updated_pos_product_links = [
            ...(changes.updated_pos_product_links ?? []),
            { id: base.id, before },
          ];
          result.drafted += 1;
          result.new_components += draft.new_components;
          continue;
        }
        const saved = await repo.upsertPosProductLink(params.companyId, next);
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
        result.drafted += 1;
        result.new_components += draft.new_components;
      } catch (err) {
        // One dish failing never stops the others; the reason is shown.
        console.error("[menu-reading draft]", err);
        result.failed += 1;
        result.skipped.push({
          odoo_name: product.odoo_name,
          reason: "no pude preparar este plato",
          code: "failed",
        });
      }
    }
  } finally {
    await repo.updateBatchSnapshot(params.companyId, batch.id, changes);
  }
  return result;
}
