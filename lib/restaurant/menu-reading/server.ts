// "Leer menú (opcional)": read the restaurant's menu once, then leave a
// Sugerido draft for every menu dish whose POS product has no recipe yet,
// and report per MENU dish (menu_outcomes). POS products are the current
// month's, grouped like Menú › Platos. Company comes
// from auth, never from the request. Every write goes into one batch, so
// "Deshacer lote" and "Empezar de nuevo" remove it like an Excel run.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { pickMenuItemForLocation } from "@/lib/restaurant/cost-workbook/menu-item-pick";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";
import { loadDishEconomicsWith } from "@/lib/restaurant/costing/dish-economics-server";
import { resumenRange } from "@/lib/restaurant/menu-resumen";
import type { MenuDish as PlatoDish } from "@/lib/restaurant/menu-dishes/menu-dishes";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
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
  buildMenuOutcomes,
  decisionsByPlato,
  planMenuDrafts,
  platoGroupsFromMenuDishes,
  platosNotOnMenu,
  type MenuDraftProduct,
  type MenuOutcome,
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
  /** Platos the MENU lists. Σ menu_outcomes = dishes_read. */
  dishes_read: number;
  /** One entry per menu dish: what happened to it and the Odoo products behind it. */
  menu_outcomes: MenuOutcome[];
  /** The counts below are menu dishes, counted from `menu_outcomes`. */
  drafted: number;
  skipped_has_recipe: number;
  skipped_no_ingredients: number;
  skipped_draft_exists: number;
  /** Menu dishes no POS product matched. */
  no_pos_match: number;
  failed: number;
  /** Platos with sales this month, sin receta, that no menu dish matched. */
  not_on_menu: number;
  /** Names of the platos in `not_on_menu` («Ver cuáles»). */
  not_found: string[];
  new_components: number;
  /** The month the POS products and `not_on_menu` were read for. */
  period: { from: string; to: string } | null;
}

/** The current month of sales, as Menú › Resumen reads it, by Platos group. */
export interface PeriodPlatos {
  range: { from: string; to: string } | null;
  products: RankedPosProduct[];
  menu_dishes: PlatoDish[];
}

export type LoadPeriodPlatos = (
  supabase: SupabaseClient,
  params: { companyId: string; locationId: string | null }
) => Promise<PeriodPlatos>;

/**
 * Products with sales in the same period Resumen opens on (the month of the
 * last day with sales) and the Platos groups built from them, so «Leer menú»
 * talks about the platos the person sees, not about all-history Odoo names.
 */
export const loadPeriodPlatos: LoadPeriodPlatos = async (
  supabase,
  { companyId, locationId }
) => {
  let q = supabase
    .from("pos_sales_items")
    .select("sale_date")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .order("sale_date", { ascending: false })
    .limit(1);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q;
  if (error) throw new Error("No se pudieron leer las ventas del POS.");
  const raw = (data as Array<{ sale_date?: unknown }> | null)?.[0]?.sale_date;
  const lastDay = typeof raw === "string" ? raw.slice(0, 10) : null;
  if (!lastDay) return { range: null, products: [], menu_dishes: [] };
  const range = resumenRange("month", lastDay);
  const load = await loadDishEconomicsWith(supabase, {
    companyId,
    from: range.from,
    to: range.to,
    locationId,
  });
  if (!load.ok) throw new Error(load.error);
  return {
    range,
    products: load.list.products,
    menu_dishes: load.result.menu_dishes,
  };
};

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
    loadPlatos?: LoadPeriodPlatos;
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
    ai: params.ai ?? createOpenAiMenuReader(params.companyId),
    createdBy: params.createdBy ?? null,
  });
  if (read.dishes.length === 0) {
    throw new MenuReadError(
      "No encontré platos en ese menú. Revisa la dirección o pega el texto del menú."
    );
  }

  const period = await (params.loadPlatos ?? loadPeriodPlatos)(supabase, {
    companyId: params.companyId,
    locationId,
  });
  const products = period.products.filter(wantsSuggestion);
  // Platos grouping (menu_dish_id): the product -> its Platos group.
  const groupOfProduct = new Map<number, string>();
  for (const plato of period.menu_dishes) {
    for (const variant of plato.variants) {
      groupOfProduct.set(variant.odoo_product_id, plato.id);
    }
  }

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
      // The recipe's plato; else the Platos group (the stripped name only
      // tells sizes apart inside it, or stands in when there is no group).
      plato_key: menuItem
        ? `item:${menuItem.id}`
        : `${groupOfProduct.get(product.odoo_product_id) ?? "-"}:name:${normalizeMatchName(stripSize(product.odoo_name))}`,
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

  const drafts = decisions.filter((d) => d.kind === "draft");
  const failedProductIds = new Set<number>();
  const result: MenuReadResult = {
    ok: true,
    batch_id: null,
    menu_source_id: read.id,
    cached: read.cached,
    truncated: menu.truncated,
    dishes_read: read.dishes.length,
    menu_outcomes: [],
    drafted: 0,
    skipped_has_recipe: 0,
    skipped_no_ingredients: 0,
    skipped_draft_exists: 0,
    no_pos_match: 0,
    failed: 0,
    not_on_menu: 0,
    not_found: [],
    new_components: 0,
    period: period.range,
  };
  // Counts come from the per-menu-dish outcomes, so they always add up.
  const finish = (): MenuReadResult => {
    result.menu_outcomes = buildMenuOutcomes(
      read.dishes,
      decisions,
      failedProductIds
    );
    for (const row of result.menu_outcomes) {
      if (row.outcome === "drafted") result.drafted += 1;
      else if (row.outcome === "has_recipe") result.skipped_has_recipe += 1;
      else if (row.outcome === "draft_exists") result.skipped_draft_exists += 1;
      else if (row.outcome === "no_ingredients") {
        result.skipped_no_ingredients += 1;
      } else if (row.outcome === "no_pos_match") result.no_pos_match += 1;
      else result.failed += 1;
    }
    const productOf = new Map(
      period.products.map((p) => [
        p.odoo_product_id,
        {
          odoo_name: p.odoo_name,
          pos_price: posPriceFromSales(p.net_sales, p.units_sold),
        },
      ])
    );
    result.not_found = platosNotOnMenu(
      platoGroupsFromMenuDishes(period.menu_dishes, (id) => productOf.get(id)),
      read.dishes
    );
    result.not_on_menu = result.not_found.length;
    return result;
  };
  if (drafts.length === 0) return finish();

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
        result.new_components += draft.new_components;
      } catch (err) {
        // One dish failing never stops the others; the outcome says so.
        console.error("[menu-reading draft]", err);
        failedProductIds.add(product.odoo_product_id);
      }
    }
  } finally {
    await repo.updateBatchSnapshot(params.companyId, batch.id, changes);
  }
  return finish();
}
