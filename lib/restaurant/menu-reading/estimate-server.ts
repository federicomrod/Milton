// «Estimar con Milton» (issue #212): the server side. For a dish that only
// has a menu draft (or no recipe), the AI proposes quantities for ONE plate
// and a typical restaurant purchase price. This is an OVERLAY:
//
// - it writes ONLY restaurant_dish_estimates and ingredient_price_estimates
//   (and, for ingredients with no real price, nothing else): never a cost
//   entry, a recipe version, a link, an ingredient;
// - a real price (latestCostEntry of ingredient_cost_entries) always wins;
// - a missing price is «Sin precio» (null), never 0;
// - a dish with an approved recipe, a «Confirmado» link, or an Excel or
//   hand-made recipe is never touched.
//
// `applyEstimateAsDraft` is the one place that copies an estimate into a draft: it
// fills quantities of EXISTING menu-draft evidence lines that still have none,
// and APPENDS each estimated line that has no matching draft line (by
// normalized name). New lines get the same «Estimado por Milton» mark. The
// version stays in review. A Sin receta plato with no draft gets the same
// empty menu-draft shell «Leer tu menú» writes, then the lines.

import { runChat, unwrapAi } from "@/lib/ai/call";
import type { SupabaseClient } from "@supabase/supabase-js";
import { latestCostEntry } from "@/lib/restaurant/costing";
import {
  AUTO_NAME_SCORE,
  bestNameMatch,
  normalizeMatchName,
} from "@/lib/restaurant/cost-workbook/names";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  findExactIngredient,
  findSynonymIngredient,
} from "@/lib/restaurant/kitchen-ingredient-match";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import {
  FLAG_MILTON_ESTIMATE,
  FLAG_NEW_SUGGESTED,
  FLAG_PENDING_INGREDIENT,
  FLAG_PENDING_QTY,
} from "@/lib/restaurant/recipe-costing/editor";
import { posPriceFromSales } from "@/lib/restaurant/recipe-costing/display";
import {
  asRecord,
  isBoundSuggestion,
  parseSuggestionEvidence,
} from "@/lib/restaurant/recipe-costing/evidence";
import { wantsSuggestion } from "@/lib/restaurant/recipe-suggestion-server";
import { pickDishVersions } from "@/lib/restaurant/costing/dish-state";
import { hasRecipe } from "@/lib/restaurant/recipe-costing/has-recipe";
import { loadVersionLineCounts } from "@/lib/restaurant/recipe-costing/has-recipe-server";
import { loadUnitConversions } from "@/lib/restaurant/unit-conversions-server";
import type { UnitConversion } from "@/lib/restaurant/units";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import {
  createRecipeAndLink,
  loadPosProductLink,
} from "@/lib/restaurant/recipe-costing/link-actions-server";
import type { RecipeActor } from "@/lib/restaurant/recipe-costing/approval";
import { nextVersionNumber } from "@/lib/restaurant/recipe-versions";
import { MENU_EVIDENCE_SOURCE, menuDraftEvidence } from "./drafts";
import { withMenuDraftEvidence } from "@/lib/restaurant/pos-product-links";
import { MENU_AI_MODEL, parseMenuDishes } from "./extract";
import {
  canEstimate,
  estimatePrompt,
  estimatedDishCost,
  estimatedMargin,
  nameKeyOf,
  parseEstimate,
  priceEstimateLines,
  type DishEstimateRow,
  type EstimateContext,
  type EstimateDishInput,
  type EstimateLineRaw,
  type EstimatedLine,
} from "./estimate";
import {
  DISH_ESTIMATES_TABLE,
  PRICE_ESTIMATES_TABLE,
  isMissingEstimateTable,
  loadDishEstimates,
  loadPriceEstimates,
} from "./estimate-store";

/** Dishes one call to the route processes. */
export const ESTIMATE_CHUNK = 5;
/** AI calls at the same time. */
export const ESTIMATE_PARALLEL = 3;
/** Dishes one run may cover (the client loops in chunks up to this). */
export const ESTIMATE_MAX_RUN = 20;
const AI_TIMEOUT_MS = 60_000;

export const ESTIMATE_TABLES_MISSING =
  "Falta aplicar la actualización de la base de datos (062).";
export const ESTIMATE_APPROVED_MESSAGE =
  "Este plato ya tiene receta aprobada; Milton no la cambia.";
export const ESTIMATE_NOT_FOUND_MESSAGE =
  "No hay un estimado de Milton para este plato.";
export const ESTIMATE_NO_DRAFT_MESSAGE =
  "Este plato no tiene un borrador del menú donde copiar el estimado.";
export const ESTIMATE_DRAFT_CREATE_MESSAGE =
  "No pude preparar el borrador del menú para este plato. Usa «Leer tu menú» y vuelve a intentar.";
export const ESTIMATE_EMPTY_MESSAGE =
  "El estimado no tiene ingredientes para copiar.";

export class EstimateTablesMissingError extends Error {
  constructor() {
    super(ESTIMATE_TABLES_MISSING);
    this.name = "EstimateTablesMissingError";
  }
}

// ---------------------------------------------------------------------------
// The AI (injected in tests)
// ---------------------------------------------------------------------------

export interface EstimateAiInput {
  system: string;
  user: string;
  /** A dish photo (https) to look at, or null. */
  imageUrl: string | null;
}
export type EstimateAi = (input: EstimateAiInput) => Promise<unknown>;

export function createOpenAiEstimator(companyId?: string | null): EstimateAi {
  // One try per call (the wrapper never retries): the single retry (without
  // the photo) is ours.
  return async ({ system, user, imageUrl }) => {
    const completion = unwrapAi(
      await runChat({
        feature: "menu-estimate",
        companyId,
        timeoutMs: AI_TIMEOUT_MS,
        params: {
          model: MENU_AI_MODEL,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            {
              role: "user",
              content: imageUrl
                ? [
                    { type: "text", text: user },
                    {
                      type: "image_url",
                      image_url: { url: imageUrl, detail: "low" },
                    },
                  ]
                : user,
            },
          ],
        },
      })
    );
    return completion.choices?.[0]?.message?.content ?? "";
  };
}

// ---------------------------------------------------------------------------
// Dish facts and eligibility (pure)
// ---------------------------------------------------------------------------

export interface DishFact {
  menu_item_id: string;
  link_id: string | null;
  name: string;
  odoo_product_id: number | null;
  location_id: string | null;
  link_state: string | null;
  evidence: Record<string, unknown>;
  /** Statuses of every recipe version of the dish. */
  version_statuses: string[];
  /**
   * The plato has a recipe by the one rule (has-recipe.ts): the version it is
   * costed with has lines. An empty version row does not count.
   */
  has_recipe_lines: boolean;
  /** That version is an approved one in force. */
  approved_with_lines: boolean;
  /** POS category, when known (a section for the AI). */
  category: string | null;
  /** POS sales, for the ranking and the average net price. */
  net_sales: number;
  units_sold: number;
}

export function isMenuDraftFact(fact: DishFact): boolean {
  return (
    fact.evidence.source === MENU_EVIDENCE_SOURCE &&
    fact.version_statuses.length <= 1 &&
    fact.version_statuses.every((status) => status === "in_review")
  );
}

/** The same rule as «Leer menú»: a plato with no recipe, or a pending menu draft. */
export function dishEligibility(
  fact: DishFact
): { ok: true } | { ok: false; reason: string } {
  const view = parseSuggestionEvidence(fact.evidence);
  const hasRecipeNow =
    fact.has_recipe_lines ||
    isBoundSuggestion(view) ||
    // A link whose evidence is neither the menu's nor empty is somebody's.
    (Object.keys(fact.evidence).length > 0 &&
      fact.evidence.source !== MENU_EVIDENCE_SOURCE &&
      view.lines.length > 0);
  const verdict = canEstimate({
    link_state: fact.link_state,
    has_recipe: hasRecipeNow,
    is_menu_draft: isMenuDraftFact(fact),
    has_approved_version: fact.approved_with_lines,
  });
  return verdict.ok ? verdict : { ok: false, reason: verdict.reason };
}

interface LinkRow {
  id: string;
  odoo_product_id: number | null;
  odoo_name: string | null;
  location_id: string | null;
  menu_item_id: string | null;
  link_state: string | null;
  evidence: unknown;
}

export interface VersionRow {
  id?: string;
  menu_item_id: string;
  status: string;
  version_number?: number;
  effective_date?: string | null;
}

export function buildDishFacts(
  links: readonly LinkRow[],
  versions: readonly VersionRow[],
  locationId: string | null,
  lineCounts: ReadonlyMap<string, number> = new Map()
): DishFact[] {
  const statuses = new Map<string, string[]>();
  const byItem = new Map<string, VersionRow[]>();
  for (const v of versions) {
    const list = statuses.get(v.menu_item_id) ?? [];
    list.push(v.status);
    statuses.set(v.menu_item_id, list);
    const rows = byItem.get(v.menu_item_id) ?? [];
    rows.push(v);
    byItem.set(v.menu_item_id, rows);
  }
  const recipeOf = (menuItemId: string) => {
    const rows = (byItem.get(menuItemId) ?? []).map((v, i) => ({
      id: v.id ?? `v${i}`,
      version_number: v.version_number ?? i + 1,
      status: v.status,
      effective_date: v.effective_date ?? null,
    }));
    const has = hasRecipe({ versions: rows, lineCounts });
    // The approved version in force is the one the plato is costed with.
    const approved = pickDishVersions(rows).approved;
    return {
      has,
      approved: Boolean(approved) && (lineCounts.get(approved!.id) ?? 0) > 0,
    };
  };
  const factByItem = new Map<string, DishFact>();
  for (const link of links) {
    if (!link.menu_item_id) continue;
    if (locationId && link.location_id && link.location_id !== locationId) {
      continue;
    }
    const fact: DishFact = {
      menu_item_id: link.menu_item_id,
      link_id: link.id,
      name: link.odoo_name ?? "",
      odoo_product_id: link.odoo_product_id,
      location_id: link.location_id,
      link_state: link.link_state,
      evidence: asRecord(link.evidence) ?? {},
      version_statuses: statuses.get(link.menu_item_id) ?? [],
      has_recipe_lines: recipeOf(link.menu_item_id).has,
      approved_with_lines: recipeOf(link.menu_item_id).approved,
      category: null,
      net_sales: 0,
      units_sold: 0,
    };
    const had = factByItem.get(link.menu_item_id);
    // Prefer the link of the asked location, then a menu draft.
    const better =
      !had ||
      (locationId &&
        fact.location_id === locationId &&
        had.location_id !== locationId) ||
      (fact.evidence.source === MENU_EVIDENCE_SOURCE &&
        had.evidence.source !== MENU_EVIDENCE_SOURCE);
    if (better) factByItem.set(link.menu_item_id, fact);
  }
  return [...factByItem.values()];
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const LINK_SELECT =
  "id, odoo_product_id, odoo_name, location_id, menu_item_id, link_state, evidence";

/** Facts for the company's linked dishes (cheap: no sales). */
export async function loadDishFacts(
  supabase: SupabaseClient,
  companyId: string,
  opts: { menuItemIds?: string[]; locationId?: string | null } = {}
): Promise<DishFact[]> {
  const ids = opts.menuItemIds;
  if (ids && ids.length === 0) return [];
  const links = await fetchAllRows<LinkRow>(() => {
    let q = supabase
      .from("pos_product_links")
      .select(LINK_SELECT)
      .eq("company_id", companyId);
    if (ids) q = q.in("menu_item_id", ids);
    return q;
  });
  if (links.error) throw new Error(links.error.message ?? "links");
  const versions = await fetchAllRows<VersionRow>(() => {
    let q = supabase
      .from("recipe_versions")
      .select("id, menu_item_id, status, version_number, effective_date")
      .eq("company_id", companyId);
    if (ids) q = q.in("menu_item_id", ids);
    return q;
  });
  if (versions.error) throw new Error(versions.error.message ?? "versions");
  const lineCounts = await loadVersionLineCounts(
    supabase,
    companyId,
    versions.rows.map((row) => row.id ?? "").filter(Boolean)
  );
  return buildDishFacts(
    links.rows,
    versions.rows,
    opts.locationId ?? null,
    lineCounts
  );
}

/** Add POS sales (for ranking and the average net price). Failure = no sales. */
async function withSales(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string | null,
  facts: DishFact[]
): Promise<DishFact[]> {
  try {
    const list = await loadPosProductList(supabase, { companyId, locationId });
    if (!list.ok) return facts;
    const byProduct = new Map(
      list.list.products.map((p) => [p.odoo_product_id, p] as const)
    );
    return facts.map((fact) => {
      const product =
        fact.odoo_product_id != null
          ? byProduct.get(fact.odoo_product_id)
          : undefined;
      return product
        ? {
            ...fact,
            net_sales: product.net_sales,
            units_sold: product.units_sold,
            category: product.category ?? null,
          }
        : fact;
    });
  } catch {
    return facts;
  }
}

interface CatalogIngredient {
  id: string;
  name: string;
  default_unit: string | null;
}

interface Catalog {
  ingredients: CatalogIngredient[];
  entries: Map<string, IngredientCostEntry[]>;
  conversions: Map<string, UnitConversion[]>;
  aliases: Map<string, string>;
}

async function loadCatalog(
  supabase: SupabaseClient,
  companyId: string
): Promise<Catalog> {
  const [ingredients, entries, conversions] = await Promise.all([
    fetchAllRowsRetryingWithoutColumns<{
      id: string;
      name: string;
      default_unit: string | null;
      archived_at?: string | null;
    }>(
      ["archived_at"],
      (select) =>
        supabase.from("ingredients").select(select).eq("company_id", companyId),
      "id, name, default_unit, archived_at"
    ),
    fetchAllRowsRetryingWithoutColumns<IngredientCostEntry>(
      ["effective_date", "date_source"],
      (select) =>
        supabase
          .from("ingredient_cost_entries")
          .select(select)
          .eq("company_id", companyId),
      "id, ingredient_id, source_type, cost_date, effective_date, unit, unit_cost, normalized_unit, normalized_unit_cost, currency, created_at",
      { hintKey: `ingredient_cost_entries:${companyId}` }
    ),
    loadUnitConversions(supabase, companyId),
  ]);
  if (ingredients.error) throw new Error("ingredients");
  if (entries.error) throw new Error("entries");
  const byIngredient = new Map<string, IngredientCostEntry[]>();
  for (const entry of entries.rows) {
    const list = byIngredient.get(entry.ingredient_id) ?? [];
    list.push(entry);
    byIngredient.set(entry.ingredient_id, list);
  }
  const aliases = new Map<string, string>();
  try {
    const repo = createSupabaseCostWorkbookRepo(supabase);
    for (const row of await repo.listIngredientAliases(companyId)) {
      aliases.set(normalizeMatchName(row.alias_name), row.ingredient_id);
    }
  } catch {
    // nothing remembered
  }
  return {
    ingredients: ingredients.rows
      .filter((row) => !row.archived_at)
      .map((row) => ({
        id: row.id,
        name: row.name,
        default_unit: row.default_unit ?? null,
      })),
    entries: byIngredient,
    conversions,
    aliases,
  };
}

async function loadCountry(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string | null
): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("restaurant_locations")
      .select("id, country")
      .eq("company_id", companyId);
    const rows = (data ?? []) as Array<{ id?: string; country?: string }>;
    const own = locationId ? rows.find((r) => r.id === locationId) : undefined;
    const pick =
      (own?.country && own.country.trim() ? own : undefined) ??
      rows.find((r) => typeof r.country === "string" && r.country.trim());
    return pick?.country?.trim() || null;
  } catch {
    return null;
  }
}

/** The menu photo of a dish, from the cached menu reading (old readings: none). */
async function loadMenuImage(
  supabase: SupabaseClient,
  companyId: string,
  fact: DishFact
): Promise<string | null> {
  const sourceId =
    typeof fact.evidence.menu_source_id === "string"
      ? fact.evidence.menu_source_id
      : null;
  if (!sourceId) return null;
  try {
    const { data } = await supabase
      .from("restaurant_menu_sources")
      .select("dishes")
      .eq("company_id", companyId)
      .eq("id", sourceId)
      .maybeSingle();
    if (!data) return null;
    const dishes = parseMenuDishes({
      dishes: (data as { dishes?: unknown }).dishes,
    });
    const wanted = nameKeyOf(String(fact.evidence.menu_dish ?? fact.name));
    return dishes.find((d) => nameKeyOf(d.name) === wanted)?.image_url ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GET: how many dishes can be estimated
// ---------------------------------------------------------------------------

/** Every plato Milton can estimate: no recipe (a Confirmado link does not matter) or a pending menu draft. */
export async function countEstimableDishes(
  supabase: SupabaseClient,
  companyId: string
): Promise<number> {
  const facts = await loadDishFacts(supabase, companyId);
  return facts.filter((fact) => dishEligibility(fact).ok).length;
}

/**
 * POS food products that have no plato yet. Milton estimates them too: the run
 * first gives each an empty recipe and link (the same path as «Crear receta»).
 * Best effort: a failure reads as 0.
 */
export async function countUnlinkedWithoutPlato(
  supabase: SupabaseClient,
  companyId: string
): Promise<number> {
  return (await listUnlinkedProducts(supabase, companyId, null)).length;
}

export interface UnlinkedProduct {
  odoo_product_id: number;
  odoo_name: string;
}

/** Unlinked POS food products, best sellers first. Failure = none. */
async function listUnlinkedProducts(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string | null
): Promise<UnlinkedProduct[]> {
  try {
    const list = await loadPosProductList(supabase, { companyId, locationId });
    if (!list.ok) return [];
    return list.list.products
      .filter((p) => wantsSuggestion(p) && !p.menu_item_id)
      .sort((a, b) => b.net_sales - a.net_sales)
      .map((p) => ({
        odoo_product_id: p.odoo_product_id,
        odoo_name: p.odoo_name,
      }));
  } catch {
    return [];
  }
}

/**
 * The plato (menu item) of each POS product, creating the empty recipe + link
 * only for a product that has none. Idempotent and never destructive: a
 * product that already has a link to a recipe (approved, draft or empty) is
 * reused as it is, so a second recipe is never created.
 */
export async function ensureProductPlatos(
  supabase: SupabaseClient,
  params: {
    companyId: string;
    actor: RecipeActor;
    products: readonly UnlinkedProduct[];
    locationId?: string | null;
  }
): Promise<{ menuItemIds: string[]; failed: number }> {
  const menuItemIds: string[] = [];
  let failed = 0;
  for (const product of params.products) {
    const name = product.odoo_name?.trim();
    if (!Number.isInteger(product.odoo_product_id) || !name) {
      failed += 1;
      continue;
    }
    try {
      const existing = await loadPosProductLink(
        supabase,
        params.companyId,
        product.odoo_product_id,
        params.locationId ?? null
      );
      if (existing?.menu_item_id) {
        menuItemIds.push(existing.menu_item_id);
        continue;
      }
      const created = await createRecipeAndLink({
        supabase,
        companyId: params.companyId,
        actor: params.actor,
        odooProductId: product.odoo_product_id,
        odooName: name,
        locationId: params.locationId ?? null,
      });
      if (created.ok) menuItemIds.push(created.menu_item_id);
      else failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { menuItemIds, failed };
}

// ---------------------------------------------------------------------------
// POST: estimate
// ---------------------------------------------------------------------------

export interface EstimateDishResult {
  menu_item_id: string;
  name: string;
  est_cost: number | null;
  est_margin_pct: number | null;
  skipped_reason: string | null;
}

export interface EstimateRunResult {
  done: number;
  remaining: number;
  results: EstimateDishResult[];
}

interface RunEnv {
  supabase: SupabaseClient;
  companyId: string;
  userId: string | null;
  ai: EstimateAi;
  catalog: Catalog;
  context: { country: string | null; currency: string };
  catalogNames: Array<{ name: string; unit: string }>;
  priceByKey: Map<string, { unit_price: number; unit: string; id: string }>;
}

function matchCatalog(rawName: string, env: RunEnv): CatalogIngredient | null {
  const key = normalizeMatchName(rawName);
  const remembered = env.catalog.aliases.get(key);
  if (remembered) {
    const hit = env.catalog.ingredients.find((i) => i.id === remembered);
    if (hit) return hit;
  }
  return (
    findExactIngredient(rawName, env.catalog.ingredients) ??
    findSynonymIngredient(rawName, env.catalog.ingredients)
  );
}

/** Use the menu's own wording for a line the AI named almost the same. */
function alignToComponents(
  lines: EstimateLineRaw[],
  components: readonly string[]
): EstimateLineRaw[] {
  const free = new Set(components);
  return lines.map((line) => {
    const key = normalizeMatchName(line.raw_name);
    const same = [...free].find((c) => normalizeMatchName(c) === key);
    if (same) {
      free.delete(same);
      return { ...line, raw_name: same };
    }
    const near = bestNameMatch(line.raw_name, [...free], (c) => c);
    if (near && near.score >= AUTO_NAME_SCORE) {
      free.delete(near.item);
      return { ...line, raw_name: near.item };
    }
    return line;
  });
}

async function askAi(
  ai: EstimateAi,
  prompt: { system: string; user: string },
  imageUrl: string | null
): Promise<unknown> {
  try {
    return await ai({ ...prompt, imageUrl });
  } catch (err) {
    if (!imageUrl) throw err;
    // OpenAI could not read the photo: try ONCE more, without it.
    return await ai({ ...prompt, imageUrl: null });
  }
}

async function estimateOne(
  fact: DishFact,
  env: RunEnv
): Promise<EstimateDishResult> {
  const result: EstimateDishResult = {
    menu_item_id: fact.menu_item_id,
    name: fact.name,
    est_cost: null,
    est_margin_pct: null,
    skipped_reason: null,
  };
  const eligible = dishEligibility(fact);
  if (!eligible.ok) return { ...result, skipped_reason: eligible.reason };

  const view = parseSuggestionEvidence(fact.evidence);
  const components = view.lines.map((line) => line.raw_name);
  const imageUrl = await loadMenuImage(env.supabase, env.companyId, fact);
  const dish: EstimateDishInput = {
    name: view.menu?.dish ?? fact.name,
    section:
      typeof fact.evidence.menu_section === "string"
        ? fact.evidence.menu_section
        : fact.category,
    description: view.menu?.description ?? null,
    components,
    menu_price: view.menu?.price ?? null,
    pos_price: posPriceFromSales(fact.net_sales, fact.units_sold),
    image_url: imageUrl,
  };
  const ctx: EstimateContext = {
    country: env.context.country,
    currency: env.context.currency,
    catalogNames: env.catalogNames,
  };

  let parsed;
  try {
    const raw = await askAi(env.ai, estimatePrompt(dish, ctx), imageUrl);
    parsed = parseEstimate(raw);
  } catch {
    // Never log the prompt or the answer.
    console.error("[menu-estimate] AI call failed");
    return { ...result, skipped_reason: "error_ia" };
  }
  if (!parsed) return { ...result, skipped_reason: "error_ia" };

  // Match to the catalog and price: a real price always wins.
  const aligned = alignToComponents(parsed.lines, components).map((line) => ({
    ...line,
    ingredient_id: matchCatalog(line.raw_name, env)?.id ?? null,
  }));
  const realPriceOf = (line: { ingredient_id?: string | null }) => {
    if (!line.ingredient_id) return null;
    const entry = latestCostEntry(
      env.catalog.entries.get(line.ingredient_id) ?? []
    );
    if (!entry) return null;
    const cost = Number(entry.normalized_unit_cost ?? entry.unit_cost);
    const unit = entry.normalized_unit || entry.unit;
    return cost > 0 && unit ? { unit_cost: cost, unit } : null;
  };
  const estimatedPriceOf = (key: string) => env.priceByKey.get(key) ?? null;
  const priced: EstimatedLine[] = aligned.map(
    (line) =>
      priceEstimateLines([line], realPriceOf, estimatedPriceOf, {
        conversions: line.ingredient_id
          ? env.catalog.conversions.get(line.ingredient_id)
          : undefined,
      })[0]
  );

  try {
    // Estimated prices are saved ONLY for names with no real price.
    const fresh = new Map<
      string,
      {
        name_key: string;
        unit: string;
        unit_price: number;
        ingredient_id: string | null;
      }
    >();
    for (const line of priced) {
      if (
        line.price_source !== "estimado" ||
        line.price_estimate_id ||
        !line.unit_price ||
        !line.price_unit ||
        realPriceOf(line)
      ) {
        continue;
      }
      const name_key = nameKeyOf(line.raw_name);
      fresh.set(`${name_key}|${line.price_unit}`, {
        name_key,
        unit: line.price_unit,
        unit_price: line.unit_price,
        ingredient_id: line.ingredient_id,
      });
    }
    if (fresh.size > 0) {
      const { data, error } = await env.supabase
        .from(PRICE_ESTIMATES_TABLE)
        .upsert(
          [...fresh.values()].map((row) => ({
            company_id: env.companyId,
            ingredient_id: row.ingredient_id,
            name_key: row.name_key,
            unit: row.unit,
            unit_price: row.unit_price,
            currency: env.context.currency,
            country: env.context.country,
            model: MENU_AI_MODEL,
            rationale: "Estimado por Milton",
          })),
          { onConflict: "company_id,name_key,unit" }
        )
        .select("id, name_key, unit");
      if (error) {
        if (isMissingEstimateTable(error))
          throw new EstimateTablesMissingError();
        throw new Error("price estimates");
      }
      for (const saved of (data ?? []) as Array<{
        id: string;
        name_key: string;
        unit: string;
      }>) {
        const row = fresh.get(`${saved.name_key}|${saved.unit}`);
        if (!row) continue;
        env.priceByKey.set(saved.name_key, {
          unit_price: row.unit_price,
          unit: row.unit,
          id: saved.id,
        });
        for (const line of priced) {
          if (
            nameKeyOf(line.raw_name) === saved.name_key &&
            line.price_unit === saved.unit &&
            line.price_source === "estimado" &&
            !line.price_estimate_id
          ) {
            line.price_estimate_id = saved.id;
          }
        }
      }
    }

    const estCost = estimatedDishCost(priced);
    const avgNet = posPriceFromSales(fact.net_sales, fact.units_sold);
    const margin = estimatedMargin(estCost, avgNet);
    const now = new Date().toISOString();
    const { error } = await env.supabase.from(DISH_ESTIMATES_TABLE).upsert(
      {
        company_id: env.companyId,
        menu_item_id: fact.menu_item_id,
        location_id: fact.location_id,
        odoo_product_id: fact.odoo_product_id,
        menu_source_id:
          typeof fact.evidence.menu_source_id === "string"
            ? fact.evidence.menu_source_id
            : null,
        lines: priced,
        portion_note: parsed.portion_note,
        est_cost: estCost,
        currency: env.context.currency,
        model: MENU_AI_MODEL,
        // A new estimate replaces the old one and has not been used yet.
        used_as_draft_at: null,
        created_by: env.userId,
        updated_at: now,
      },
      { onConflict: "company_id,menu_item_id" }
    );
    if (error) {
      if (isMissingEstimateTable(error)) throw new EstimateTablesMissingError();
      throw new Error("dish estimate");
    }
    return { ...result, est_cost: estCost, est_margin_pct: margin };
  } catch (err) {
    if (err instanceof EstimateTablesMissingError) throw err;
    console.error("[menu-estimate] save failed");
    return { ...result, skipped_reason: "error_guardado" };
  }
}

async function inPool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await work(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, worker)
  );
  return out;
}

export interface EstimateRunParams {
  companyId: string;
  userId: string | null;
  menuItemIds?: string[];
  /**
   * POS products with no plato yet (or with one): each gets its empty recipe
   * + link first when it has none, then is estimated. Needs `actor`.
   */
  products?: UnlinkedProduct[];
  actor?: RecipeActor;
  locationId?: string | null;
  limit?: number;
  ai?: EstimateAi;
}

/**
 * One call: at most ESTIMATE_CHUNK dishes, ESTIMATE_PARALLEL at a time. Throws
 * EstimateTablesMissingError when migration 062 is not applied (before any
 * AI call is paid for).
 */
export async function estimateDishes(
  supabase: SupabaseClient,
  params: EstimateRunParams
): Promise<EstimateRunResult> {
  const existing = await loadDishEstimates(supabase, params.companyId);
  if (!existing.ok) {
    if (existing.unavailable) throw new EstimateTablesMissingError();
    throw new Error("No pude leer los estimados.");
  }
  const limit = Math.min(
    Math.max(1, Math.floor(params.limit ?? ESTIMATE_MAX_RUN)),
    ESTIMATE_MAX_RUN
  );
  const locationId = params.locationId ?? null;
  let ids = params.menuItemIds
    ? [...new Set(params.menuItemIds.filter((id) => typeof id === "string"))]
    : null;
  let failedLinks = 0;
  if (params.products) {
    // Asking for products is never a bulk run, even if none could be linked.
    ids = ids ?? [];
  }
  if (params.products && params.products.length > 0 && params.actor) {
    const ensured = await ensureProductPlatos(supabase, {
      companyId: params.companyId,
      actor: params.actor,
      products: params.products.slice(0, limit),
      locationId,
    });
    failedLinks = ensured.failed;
    ids = [...new Set([...(ids ?? []), ...ensured.menuItemIds])];
  }

  const facts = await withSales(
    supabase,
    params.companyId,
    locationId,
    await loadDishFacts(supabase, params.companyId, {
      menuItemIds: ids ?? undefined,
      locationId,
    })
  );

  let pool: Array<DishFact | { missing: string }>;
  if (ids) {
    const byId = new Map(facts.map((f) => [f.menu_item_id, f] as const));
    pool = ids.slice(0, limit).map((id) => byId.get(id) ?? { missing: id });
  } else {
    const done = new Set(existing.rows.map((row) => row.menu_item_id));
    pool = facts
      .filter((f) => dishEligibility(f).ok && !done.has(f.menu_item_id))
      .sort(
        (a, b) =>
          b.net_sales - a.net_sales ||
          a.name.localeCompare(b.name, "es") ||
          a.menu_item_id.localeCompare(b.menu_item_id)
      )
      .slice(0, limit);
  }
  // Bulk run: when the plato list runs out, give the best-selling products
  // with no plato yet their empty recipe + link and estimate them too.
  if (!ids && params.actor && pool.length < ESTIMATE_CHUNK) {
    const unlinked = await listUnlinkedProducts(
      supabase,
      params.companyId,
      locationId
    );
    if (unlinked.length > 0) {
      const ensured = await ensureProductPlatos(supabase, {
        companyId: params.companyId,
        actor: params.actor,
        products: unlinked.slice(
          0,
          Math.min(limit, ESTIMATE_CHUNK) - pool.length
        ),
        locationId,
      });
      if (ensured.menuItemIds.length > 0) {
        const added = await withSales(
          supabase,
          params.companyId,
          locationId,
          await loadDishFacts(supabase, params.companyId, {
            menuItemIds: ensured.menuItemIds,
            locationId,
          })
        );
        pool = [...pool, ...added.filter((f) => dishEligibility(f).ok)];
      }
    }
  }
  const batch = pool.slice(0, ESTIMATE_CHUNK);
  const remaining = pool.length - batch.length;

  const needsAi = batch.some(
    (entry) => "menu_item_id" in entry && dishEligibility(entry).ok
  );
  let env: RunEnv | null = null;
  if (needsAi) {
    const [catalog, country, currency, prices] = await Promise.all([
      loadCatalog(supabase, params.companyId),
      loadCountry(supabase, params.companyId, locationId),
      resolveCompanyCurrency(supabase, params.companyId),
      loadPriceEstimates(supabase, params.companyId),
    ]);
    if (!prices.ok && prices.unavailable)
      throw new EstimateTablesMissingError();
    const priceByKey = new Map<
      string,
      { unit_price: number; unit: string; id: string }
    >();
    if (prices.ok) {
      for (const row of prices.rows) {
        if (!priceByKey.has(row.name_key)) {
          priceByKey.set(row.name_key, {
            unit_price: row.unit_price,
            unit: row.unit,
            id: row.id,
          });
        }
      }
    }
    env = {
      supabase,
      companyId: params.companyId,
      userId: params.userId,
      ai: params.ai ?? createOpenAiEstimator(params.companyId),
      catalog,
      context: { country, currency: currency || "USD" },
      catalogNames: catalog.ingredients.map((i) => ({
        name: i.name,
        unit: i.default_unit ?? "unidad",
      })),
      priceByKey,
    };
  }

  const results = await inPool(batch, ESTIMATE_PARALLEL, async (entry) => {
    if (!("menu_item_id" in entry)) {
      return {
        menu_item_id: entry.missing,
        name: "",
        est_cost: null,
        est_margin_pct: null,
        skipped_reason: "no_encontrado",
      } satisfies EstimateDishResult;
    }
    if (!env) {
      const eligible = dishEligibility(entry);
      return {
        menu_item_id: entry.menu_item_id,
        name: entry.name,
        est_cost: null,
        est_margin_pct: null,
        skipped_reason: eligible.ok ? "error_ia" : eligible.reason,
      } satisfies EstimateDishResult;
    }
    return estimateOne(entry, env);
  });
  return {
    done: results.filter((r) => !r.skipped_reason).length,
    remaining,
    results: [
      ...results,
      ...Array.from({ length: failedLinks }, () => ({
        menu_item_id: "",
        name: "",
        est_cost: null,
        est_margin_pct: null,
        skipped_reason: "no_encontrado",
      })),
    ],
  };
}

// ---------------------------------------------------------------------------
// «Usar como borrador»
// ---------------------------------------------------------------------------

export interface ApplyEstimateResult {
  evidence: Record<string, unknown>;
  applied: number;
  /** Estimate lines that matched an existing draft line we did not fill. */
  not_copied: string[];
}

function lineNameKeys(row: Record<string, unknown>): string[] {
  return [
    typeof row.raw_name === "string" ? row.raw_name : "",
    typeof row.ingredient_match === "string" ? row.ingredient_match : "",
  ]
    .filter(Boolean)
    .map((n) => nameKeyOf(n));
}

function filledEstimateFlags(row: Record<string, unknown>): string[] {
  const flags = (
    Array.isArray(row.flags)
      ? row.flags.filter((f): f is string => typeof f === "string")
      : []
  ).filter((flag) => flag !== FLAG_PENDING_QTY);
  if (!flags.includes(FLAG_MILTON_ESTIMATE)) flags.push(FLAG_MILTON_ESTIMATE);
  return flags;
}

function filledEstimateReasons(row: Record<string, unknown>): string[] {
  const reasons = (
    Array.isArray(row.reasons)
      ? row.reasons.filter((r): r is string => typeof r === "string")
      : []
  ).map((reason) =>
    reason.replace(" Confírmalo y escribe cuánto lleva.", " Confírmalo.")
  );
  return [
    "Estimado por Milton: revisa la cantidad y la unidad antes de aprobar.",
    ...reasons,
  ];
}

/** One new evidence line from an estimate: pending, no unit cost, no input. */
export function evidenceLineFromEstimate(
  estimate: EstimatedLine,
  matchName: string | null = null
): Record<string, unknown> {
  const matched = Boolean(matchName || estimate.ingredient_id);
  const flags = [FLAG_PENDING_INGREDIENT];
  if (!(estimate.qty > 0)) flags.push(FLAG_PENDING_QTY);
  flags.push(FLAG_MILTON_ESTIMATE);
  if (!matched) flags.push(FLAG_NEW_SUGGESTED);
  return {
    source_row: null,
    raw_name: estimate.raw_name,
    ingredient_match:
      matchName ?? (estimate.ingredient_id ? estimate.raw_name : null),
    sub_recipe_match: null,
    qty: estimate.qty,
    unit: estimate.unit,
    unit_cost: null,
    pending: true,
    flags,
    reasons: [
      "Estimado por Milton: revisa la cantidad y la unidad antes de aprobar.",
    ],
  };
}

/**
 * Pure. Fill the quantity and unit of the EXISTING menu-draft evidence lines
 * that still have none (matched by normalized name), mark them «Estimado por
 * Milton» and drop `pendiente_cantidad`. A line a person already resolved or
 * typed is left alone (not duplicated). Each estimate line with no matching
 * draft line is APPENDED, flagged the same way. `pendiente_ingrediente` /
 * `nuevo_sugerido` stay. No unit cost, no input, no ingredient is created.
 */
export function applyEstimateToEvidence(
  evidence: Record<string, unknown>,
  estimateLines: readonly EstimatedLine[],
  opts?: { matchNameOf?: (line: EstimatedLine) => string | null }
): ApplyEstimateResult {
  const rawLines = Array.isArray(evidence.lines) ? evidence.lines : [];
  const free = new Map<string, EstimatedLine>();
  for (const line of estimateLines) {
    const key = nameKeyOf(line.raw_name);
    if (!free.has(key)) free.set(key, line);
  }
  let applied = 0;
  const skipped: string[] = [];
  const lines = rawLines.map((item) => {
    const row = asRecord(item);
    if (!row) return item;
    const keys = lineNameKeys(row);
    const hitKey = keys.find((k) => free.has(k));
    const hasQty = typeof row.qty === "number" && row.qty > 0;
    const resolved = typeof row.input_id === "string" && row.input_id !== "";
    if (hasQty || resolved || typeof row.raw_name !== "string") {
      if (hitKey) {
        skipped.push(free.get(hitKey)!.raw_name);
        free.delete(hitKey);
      }
      return item;
    }
    if (!hitKey) return item;
    const estimate = free.get(hitKey)!;
    free.delete(hitKey);
    applied += 1;
    return {
      ...row,
      qty: estimate.qty,
      unit: estimate.unit,
      flags: filledEstimateFlags(row),
      reasons: filledEstimateReasons(row),
    };
  });
  for (const estimate of free.values()) {
    applied += 1;
    lines.push(
      evidenceLineFromEstimate(estimate, opts?.matchNameOf?.(estimate) ?? null)
    );
  }
  const allHaveQty =
    lines.length > 0 &&
    lines.every((item) => {
      const row = asRecord(item);
      return row && typeof row.qty === "number" && row.qty > 0;
    });
  return {
    evidence: {
      ...evidence,
      lines,
      ...(applied > 0 && allHaveQty
        ? {
            reasons: [
              "Cantidades estimadas por Milton: revísalas antes de aprobar.",
            ],
          }
        : {}),
    },
    applied,
    not_copied: skipped,
  };
}

export type UseEstimateOutcome =
  | {
      ok: true;
      applied: number;
      not_copied: string[];
      used_as_draft_at: string | null;
      version_status: "in_review";
    }
  | { ok: false; status: number; error: string };

function menuDraftShellEvidence(fact: DishFact): Record<string, unknown> {
  const dishName =
    (typeof fact.evidence.menu_dish === "string" && fact.evidence.menu_dish) ||
    fact.name;
  return menuDraftEvidence({
    match: {
      dish: {
        name: dishName,
        section:
          typeof fact.evidence.menu_section === "string"
            ? fact.evidence.menu_section
            : fact.category,
        price:
          typeof fact.evidence.menu_price === "number"
            ? fact.evidence.menu_price
            : null,
        description:
          typeof fact.evidence.menu_description === "string"
            ? fact.evidence.menu_description
            : null,
        variants: [],
        components: [],
      },
      variant: null,
      basis: "name",
    } as never,
    lines: [],
    menuSourceId:
      typeof fact.evidence.menu_source_id === "string"
        ? fact.evidence.menu_source_id
        : null,
    menuUrl:
      typeof fact.evidence.menu_url === "string"
        ? fact.evidence.menu_url
        : null,
  });
}

/**
 * The same writes «Leer tu menú» does for a Sin receta plato: an empty
 * in_review version (when none exists) and a menu-draft evidence shell.
 * Nothing is created ad hoc — recipe / version fields match server.ts.
 */
async function ensureMenuDraftShell(
  supabase: SupabaseClient,
  params: { companyId: string; fact: DishFact }
): Promise<
  | { ok: true; evidence: Record<string, unknown>; linkId: string }
  | { ok: false; status: number; error: string }
> {
  const { companyId, fact } = params;
  if (!fact.link_id) {
    return { ok: false, status: 404, error: "No encontré ese plato." };
  }
  const existingLines = Array.isArray(fact.evidence.lines)
    ? fact.evidence.lines
    : [];
  const alreadyDraft = fact.evidence.source === MENU_EVIDENCE_SOURCE;
  let versionId: string | null =
    typeof fact.evidence.recipe_version_id === "string"
      ? fact.evidence.recipe_version_id
      : null;

  if (fact.version_statuses.length === 0) {
    const created = await createMenuDraftVersion(supabase, {
      companyId,
      fact,
    });
    if (!created.ok) return created;
    versionId = created.versionId;
  } else if (!versionId) {
    const versions = await fetchAllRows<{ id: string; status: string }>(() =>
      supabase
        .from("recipe_versions")
        .select("id, status")
        .eq("company_id", companyId)
        .eq("menu_item_id", fact.menu_item_id)
    );
    if (versions.error) {
      return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
    }
    versionId =
      versions.rows.find((row) => row.status === "in_review")?.id ??
      versions.rows[0]?.id ??
      null;
  }

  const evidence = alreadyDraft
    ? {
        ...fact.evidence,
        lines: existingLines,
        ...(versionId && !fact.evidence.recipe_version_id
          ? { recipe_version_id: versionId }
          : {}),
      }
    : { ...menuDraftShellEvidence(fact), recipe_version_id: versionId };
  return { ok: true, evidence, linkId: fact.link_id };
}

async function createMenuDraftVersion(
  supabase: SupabaseClient,
  params: { companyId: string; fact: DishFact }
): Promise<
  { ok: true; versionId: string } | { ok: false; status: number; error: string }
> {
  const { companyId, fact } = params;
  try {
    const existing = await supabase
      .from("recipes")
      .select("id")
      .eq("company_id", companyId)
      .eq("menu_item_id", fact.menu_item_id)
      .maybeSingle();
    if (existing.error) {
      return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
    }
    let recipeId =
      existing.data && typeof existing.data.id === "string"
        ? existing.data.id
        : null;
    if (!recipeId) {
      const inserted = await supabase
        .from("recipes")
        .insert({
          company_id: companyId,
          menu_item_id: fact.menu_item_id,
          name: fact.name,
          status: "active",
          serving_quantity: 1,
          serving_unit: "portion",
          source_type: "import",
          source_id:
            typeof fact.evidence.menu_source_id === "string"
              ? fact.evidence.menu_source_id
              : null,
        })
        .select("id")
        .single();
      if (inserted.error || !inserted.data) {
        return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
      }
      recipeId = String(inserted.data.id);
    }
    const listed = await fetchAllRows<{ version_number?: number }>(() =>
      supabase
        .from("recipe_versions")
        .select("id, version_number")
        .eq("company_id", companyId)
        .eq("recipe_id", recipeId)
    );
    if (listed.error) {
      return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
    }
    const version = await supabase
      .from("recipe_versions")
      .insert({
        company_id: companyId,
        recipe_id: recipeId,
        menu_item_id: fact.menu_item_id,
        version_number: nextVersionNumber(
          listed.rows.map((row) => ({
            version_number: Number(row.version_number ?? 0),
          }))
        ),
        status: "in_review",
        effective_date: null,
        source_type: "import",
        notes: "Borrador desde el menú",
      })
      .select("id")
      .single();
    if (version.error || !version.data) {
      return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
    }
    return { ok: true, versionId: String(version.data.id) };
  } catch {
    return { ok: false, status: 500, error: ESTIMATE_DRAFT_CREATE_MESSAGE };
  }
}

export async function applyEstimateAsDraft(
  supabase: SupabaseClient,
  params: { companyId: string; menuItemId: string }
): Promise<UseEstimateOutcome> {
  const estimates = await loadDishEstimates(supabase, params.companyId);
  if (!estimates.ok) {
    return estimates.unavailable
      ? { ok: false, status: 503, error: ESTIMATE_TABLES_MISSING }
      : { ok: false, status: 500, error: "No pude leer el estimado." };
  }
  const estimate: DishEstimateRow | undefined = estimates.rows.find(
    (row) => row.menu_item_id === params.menuItemId
  );
  if (!estimate) {
    return { ok: false, status: 404, error: ESTIMATE_NOT_FOUND_MESSAGE };
  }
  if (estimate.lines.length === 0) {
    return { ok: false, status: 409, error: ESTIMATE_EMPTY_MESSAGE };
  }

  let facts: DishFact[];
  try {
    facts = await loadDishFacts(supabase, params.companyId, {
      menuItemIds: [params.menuItemId],
      locationId: estimate.location_id,
    });
  } catch {
    return { ok: false, status: 500, error: "No pude leer el plato." };
  }
  const fact =
    facts.find(
      (f) =>
        estimate.odoo_product_id != null &&
        f.odoo_product_id === estimate.odoo_product_id
    ) ?? facts[0];
  if (!fact || !fact.link_id) {
    return { ok: false, status: 404, error: "No encontré ese plato." };
  }
  // Approved, Confirmado with a real recipe, Excel or hand-made: nothing
  // is written. A Confirmado link alone does not block.
  if (!dishEligibility(fact).ok) {
    return { ok: false, status: 409, error: ESTIMATE_APPROVED_MESSAGE };
  }

  const alreadyDraft = isMenuDraftFact(fact);
  if (!alreadyDraft && (fact.has_recipe_lines || fact.approved_with_lines)) {
    return { ok: false, status: 409, error: ESTIMATE_NO_DRAFT_MESSAGE };
  }

  const shell = await ensureMenuDraftShell(supabase, {
    companyId: params.companyId,
    fact,
  });
  if (!shell.ok) return shell;

  const catalogNames = new Map<string, string>();
  for (const line of estimate.lines) {
    if (line.ingredient_id && line.raw_name) {
      catalogNames.set(line.ingredient_id, line.raw_name);
    }
  }
  const applied = applyEstimateToEvidence(shell.evidence, estimate.lines, {
    matchNameOf: (line) =>
      line.ingredient_id
        ? (catalogNames.get(line.ingredient_id) ?? null)
        : null,
  });
  if (applied.applied === 0) {
    return { ok: false, status: 409, error: ESTIMATE_NO_DRAFT_MESSAGE };
  }

  let evidenceToWrite = applied.evidence;
  try {
    const link = fact.odoo_product_id
      ? await loadPosProductLink(
          supabase,
          params.companyId,
          fact.odoo_product_id,
          fact.location_id
        )
      : null;
    if (link?.id === fact.link_id) {
      evidenceToWrite = withMenuDraftEvidence(link, {
        menu_item_id: fact.menu_item_id,
        evidence: applied.evidence,
      }).evidence;
    }
  } catch {
    // The draft lines still save on the existing link.
  }

  // Only the draft's evidence lines change: no link state, cost entry
  // or ingredient is written. A new version is created only when the
  // plato had none (same writes as «Leer tu menú»).
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("pos_product_links")
    .update({ evidence: evidenceToWrite, updated_at: now })
    .eq("company_id", params.companyId)
    .eq("id", fact.link_id);
  if (error) {
    return { ok: false, status: 500, error: "No pude guardar el borrador." };
  }
  const marked = await supabase
    .from(DISH_ESTIMATES_TABLE)
    .update({ used_as_draft_at: now })
    .eq("company_id", params.companyId)
    .eq("menu_item_id", params.menuItemId);
  if (marked.error) console.error("[menu-estimate] could not mark as used");
  return {
    ok: true,
    applied: applied.applied,
    not_copied: applied.not_copied,
    used_as_draft_at: marked.error ? null : now,
    version_status: "in_review",
  };
}
