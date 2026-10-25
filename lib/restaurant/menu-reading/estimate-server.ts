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
// fills the quantities of the EXISTING menu-draft evidence lines and marks
// them «Estimado por Milton». The version stays in review.

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
  FLAG_PENDING_QTY,
} from "@/lib/restaurant/recipe-costing/editor";
import { posPriceFromSales } from "@/lib/restaurant/recipe-costing/display";
import {
  asRecord,
  isBoundSuggestion,
  parseSuggestionEvidence,
} from "@/lib/restaurant/recipe-costing/evidence";
import { loadUnitConversions } from "@/lib/restaurant/unit-conversions-server";
import type { UnitConversion } from "@/lib/restaurant/units";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import { MENU_EVIDENCE_SOURCE } from "./drafts";
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

export function createOpenAiEstimator(): EstimateAi {
  // One client for the whole run (the calls run a few at a time).
  let clientPromise: Promise<import("openai").OpenAI> | null = null;
  const getClient = () =>
    (clientPromise ??= import("openai").then((mod) => {
      const OpenAI =
        mod.OpenAI ??
        (mod as unknown as { default: typeof import("openai").OpenAI }).default;
      // One try per call: the single retry (without the photo) is ours.
      return new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: AI_TIMEOUT_MS,
        maxRetries: 0,
      });
    }));
  return async ({ system, user, imageUrl }) => {
    const client = await getClient();
    const completion = await client.chat.completions.create({
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
    });
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

/** The same rules as «Leer menú»: only a menu draft or a dish with no recipe. */
export function dishEligibility(
  fact: DishFact
): { ok: true } | { ok: false; reason: string } {
  const view = parseSuggestionEvidence(fact.evidence);
  const hasRecipe =
    fact.version_statuses.length > 0 ||
    isBoundSuggestion(view) ||
    // A link whose evidence is neither the menu's nor empty is somebody's.
    (Object.keys(fact.evidence).length > 0 &&
      fact.evidence.source !== MENU_EVIDENCE_SOURCE &&
      view.lines.length > 0);
  const verdict = canEstimate({
    link_state: fact.link_state,
    has_recipe: hasRecipe,
    is_menu_draft: isMenuDraftFact(fact),
    has_approved_version: fact.version_statuses.includes("approved"),
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

export function buildDishFacts(
  links: readonly LinkRow[],
  versions: ReadonlyArray<{ menu_item_id: string; status: string }>,
  locationId: string | null
): DishFact[] {
  const statuses = new Map<string, string[]>();
  for (const v of versions) {
    const list = statuses.get(v.menu_item_id) ?? [];
    list.push(v.status);
    statuses.set(v.menu_item_id, list);
  }
  const byItem = new Map<string, DishFact>();
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
      net_sales: 0,
      units_sold: 0,
    };
    const had = byItem.get(link.menu_item_id);
    // Prefer the link of the asked location, then a menu draft.
    const better =
      !had ||
      (locationId &&
        fact.location_id === locationId &&
        had.location_id !== locationId) ||
      (fact.evidence.source === MENU_EVIDENCE_SOURCE &&
        had.evidence.source !== MENU_EVIDENCE_SOURCE);
    if (better) byItem.set(link.menu_item_id, fact);
  }
  return [...byItem.values()];
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
  const versions = await fetchAllRows<{ menu_item_id: string; status: string }>(
    () => {
      let q = supabase
        .from("recipe_versions")
        .select("id, menu_item_id, status")
        .eq("company_id", companyId);
      if (ids) q = q.in("menu_item_id", ids);
      return q;
    }
  );
  if (versions.error) throw new Error(versions.error.message ?? "versions");
  return buildDishFacts(links.rows, versions.rows, opts.locationId ?? null);
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

export async function countEligibleMenuDrafts(
  supabase: SupabaseClient,
  companyId: string
): Promise<number> {
  const facts = await loadDishFacts(supabase, companyId);
  return facts.filter(
    (fact) => isMenuDraftFact(fact) && dishEligibility(fact).ok
  ).length;
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
        : null,
    description: view.menu?.description ?? null,
    components,
    menu_price: view.menu?.price ?? null,
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
  const ids = params.menuItemIds
    ? [...new Set(params.menuItemIds.filter((id) => typeof id === "string"))]
    : null;

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
      .filter(
        (f) =>
          isMenuDraftFact(f) &&
          dishEligibility(f).ok &&
          !done.has(f.menu_item_id)
      )
      .sort(
        (a, b) =>
          b.net_sales - a.net_sales ||
          a.name.localeCompare(b.name, "es") ||
          a.menu_item_id.localeCompare(b.menu_item_id)
      )
      .slice(0, limit);
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
      ai: params.ai ?? createOpenAiEstimator(),
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
    results,
  };
}

// ---------------------------------------------------------------------------
// «Usar como borrador»
// ---------------------------------------------------------------------------

export interface ApplyEstimateResult {
  evidence: Record<string, unknown>;
  applied: number;
  /** Estimate lines with no draft line to go into (nothing is added). */
  not_copied: string[];
}

/**
 * Pure. Fill the quantity and unit of the EXISTING menu-draft evidence lines
 * that still have none (matched by name), mark them «Estimado por Milton» and
 * drop `pendiente_cantidad`. A line a person already resolved or typed is
 * left alone. `pendiente_ingrediente` / `nuevo_sugerido` stay. No unit cost,
 * no input, no ingredient is created.
 */
export function applyEstimateToEvidence(
  evidence: Record<string, unknown>,
  estimateLines: readonly EstimatedLine[]
): ApplyEstimateResult {
  const rawLines = Array.isArray(evidence.lines) ? evidence.lines : [];
  const free = new Map<string, EstimatedLine>();
  for (const line of estimateLines) {
    const key = nameKeyOf(line.raw_name);
    if (!free.has(key)) free.set(key, line);
  }
  let applied = 0;
  const lines = rawLines.map((item) => {
    const row = asRecord(item);
    if (!row) return item;
    const hasQty = typeof row.qty === "number" && row.qty > 0;
    const resolved = typeof row.input_id === "string" && row.input_id !== "";
    if (hasQty || resolved || typeof row.raw_name !== "string") return item;
    const keys = [
      row.raw_name,
      typeof row.ingredient_match === "string" ? row.ingredient_match : "",
    ]
      .filter(Boolean)
      .map((n) => nameKeyOf(n as string));
    const hitKey = keys.find((k) => free.has(k));
    if (!hitKey) return item;
    const estimate = free.get(hitKey)!;
    free.delete(hitKey);
    applied += 1;
    const flags = (
      Array.isArray(row.flags)
        ? row.flags.filter((f): f is string => typeof f === "string")
        : []
    ).filter((flag) => flag !== FLAG_PENDING_QTY);
    if (!flags.includes(FLAG_MILTON_ESTIMATE)) flags.push(FLAG_MILTON_ESTIMATE);
    const reasons = (
      Array.isArray(row.reasons)
        ? row.reasons.filter((r): r is string => typeof r === "string")
        : []
    ).map((reason) =>
      reason.replace(" Confírmalo y escribe cuánto lleva.", " Confírmalo.")
    );
    return {
      ...row,
      qty: estimate.qty,
      unit: estimate.unit,
      flags,
      reasons: [
        "Estimado por Milton: revisa la cantidad y la unidad antes de aprobar.",
        ...reasons,
      ],
    };
  });
  const allHaveQty = lines.every((item) => {
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
    not_copied: [...free.values()].map((line) => line.raw_name),
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
  // Approved, Confirmado, Excel or hand-made meanwhile: nothing is written.
  if (!dishEligibility(fact).ok) {
    return { ok: false, status: 409, error: ESTIMATE_APPROVED_MESSAGE };
  }
  if (
    !isMenuDraftFact(fact) ||
    fact.version_statuses.length !== 1 ||
    !Array.isArray(fact.evidence.lines) ||
    fact.evidence.lines.length === 0
  ) {
    return { ok: false, status: 409, error: ESTIMATE_NO_DRAFT_MESSAGE };
  }

  const applied = applyEstimateToEvidence(fact.evidence, estimate.lines);
  if (applied.applied === 0) {
    return { ok: false, status: 409, error: ESTIMATE_NO_DRAFT_MESSAGE };
  }

  // Only the draft's evidence lines change: no version, link state, entry
  // or ingredient is written.
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("pos_product_links")
    .update({ evidence: applied.evidence, updated_at: now })
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
