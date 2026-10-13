import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveIngredientPriceDate } from "@/lib/restaurant/price-date";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { parseSuggestionEvidence, parseSuggestionLine } from "./evidence";
import { applyInlineLineFix } from "./review";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { loadPosProductLink } from "./link-actions-server";
import {
  matchExistingIngredient,
  unmatchedIngredientMessage,
  type CatalogIngredientRef,
} from "./ingredient-match";

export async function applyReviewFix(input: {
  supabase: SupabaseClient;
  companyId: string;
  odooProductId: number;
  locationId?: string | null;
  sourceRow?: number | null;
  rawName: string;
  unit?: string;
  quantity?: number;
  yieldValue?: number;
  unitCost?: number;
  addLine?: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const link = await loadPosProductLink(
    input.supabase,
    input.companyId,
    input.odooProductId,
    input.locationId
  );
  if (!link)
    return { ok: false, error: "No hay un vínculo para este producto." };

  const evidence = { ...link.evidence };
  const parsed = parseSuggestionEvidence(evidence);
  const lines = Array.isArray(evidence.lines) ? [...evidence.lines] : [];
  const index = lines.findIndex((raw) => {
    const line = parseSuggestionLine(raw);
    if (!line) return false;
    if (input.sourceRow != null && line.source_row === input.sourceRow)
      return true;
    return (
      line.raw_name.trim().toLowerCase() === input.rawName.trim().toLowerCase()
    );
  });
  if (index < 0) {
    if (!input.addLine) {
      return { ok: false, error: "No encontré esa línea para corregir." };
    }
    lines.push({
      raw_name: input.rawName,
      qty: input.quantity ?? 1,
      unit: input.unit ?? "g",
      unit_cost: input.unitCost ?? null,
      pending: input.unitCost == null,
      flags: input.unitCost == null ? ["pendiente_costo"] : ["ok"],
      reasons: [],
      source_row: null,
    });
    evidence.lines = lines;
    evidence.pending = lines.some((raw) => parseSuggestionLine(raw)?.pending);
    if (link.id) {
      const { error } = await input.supabase
        .from("pos_product_links")
        .update({ evidence, updated_at: new Date().toISOString() })
        .eq("company_id", input.companyId)
        .eq("id", link.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  }
  const current = parseSuggestionLine(lines[index]);
  if (!current)
    return { ok: false, error: "No encontré esa línea para corregir." };
  // A typed price only ever lands on an ingredient that already exists
  // in the catalog. Nothing is written until that is settled, and a new
  // ingredient is never created from a typed name.
  let priceTarget: CatalogIngredientRef | null = null;
  if (typeof input.unitCost === "number" && input.unitCost > 0) {
    const lineName = current.ingredient_match || current.raw_name;
    const catalog = await loadCompanyIngredientRefs(
      input.supabase,
      input.companyId
    );
    const aliases = await loadAliasMap(input.supabase, input.companyId);
    const match = matchExistingIngredient(lineName, catalog, aliases);
    if (match.kind !== "exact") {
      return {
        ok: false,
        error: unmatchedIngredientMessage(lineName, match),
      };
    }
    priceTarget = match.ingredient;
  }
  const next = applyInlineLineFix(current, {
    unit: input.unit,
    quantity: input.quantity,
    unit_cost: input.unitCost,
  });
  const prev = lines[index] as Record<string, unknown>;
  lines[index] = {
    ...prev,
    qty: next.qty,
    unit: next.unit,
    unit_cost: next.unit_cost,
    pending: next.pending,
    flags: next.flags,
    reasons: next.reasons,
  };
  evidence.lines = lines;
  evidence.pending = lines.some((raw) => parseSuggestionLine(raw)?.pending);
  if (typeof input.yieldValue === "number" && input.yieldValue > 0) {
    const prevYield =
      evidence.yield && typeof evidence.yield === "object"
        ? (evidence.yield as Record<string, unknown>)
        : {};
    evidence.yield = {
      ...prevYield,
      value: input.yieldValue,
      source: "confirmed",
    };
  }

  if (link.id) {
    const { error } = await input.supabase
      .from("pos_product_links")
      .update({ evidence, updated_at: new Date().toISOString() })
      .eq("company_id", input.companyId)
      .eq("id", link.id);
    if (error) throw new Error(error.message);
  }

  if (link.menu_item_id && (input.unit || input.quantity)) {
    await patchVersionInput(input);
  }

  if (priceTarget && typeof input.unitCost === "number") {
    await writeManualPrice({
      supabase: input.supabase,
      companyId: input.companyId,
      ingredient: priceTarget,
      unit: next.unit || "unit",
      unitCost: input.unitCost,
    });
  }

  void parsed;
  return { ok: true };
}

async function patchVersionInput(input: {
  supabase: SupabaseClient;
  companyId: string;
  odooProductId: number;
  rawName: string;
  unit?: string;
  quantity?: number;
}) {
  const { data: link } = await input.supabase
    .from("pos_product_links")
    .select("menu_item_id")
    .eq("company_id", input.companyId)
    .eq("odoo_product_id", input.odooProductId)
    .maybeSingle();
  const menuItemId =
    typeof link?.menu_item_id === "string" ? link.menu_item_id : null;
  if (!menuItemId) return;
  const versions = await input.supabase
    .from("recipe_versions")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("menu_item_id", menuItemId)
    .eq("status", "in_review")
    .order("version_number", { ascending: false })
    .limit(1);
  const versionId = versions.data?.[0]?.id;
  if (!versionId) return;
  const { data: rows } = await input.supabase
    .from("recipe_version_inputs")
    .select("id, notes, unit, quantity")
    .eq("company_id", input.companyId)
    .eq("recipe_version_id", versionId);
  const target = (rows ?? []).find((row) =>
    String(row.notes ?? "")
      .toLowerCase()
      .includes(input.rawName.toLowerCase())
  );
  if (!target) return;
  const patch: Record<string, unknown> = {};
  if (input.unit) patch.unit = input.unit;
  if (typeof input.quantity === "number") patch.quantity = input.quantity;
  if (Object.keys(patch).length === 0) return;
  await input.supabase
    .from("recipe_version_inputs")
    .update(patch)
    .eq("company_id", input.companyId)
    .eq("id", target.id);
}

/** Remembered names (normalised alias -> ingredient id). Best effort. */
async function loadAliasMap(
  supabase: SupabaseClient,
  companyId: string
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data, error } = await supabase
      .from("ingredient_aliases")
      .select("alias_name, ingredient_id")
      .eq("company_id", companyId);
    if (error) return map;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (
        typeof row.alias_name === "string" &&
        typeof row.ingredient_id === "string"
      ) {
        map.set(normalizeMatchName(row.alias_name), row.ingredient_id);
      }
    }
  } catch {
    // No alias table yet (migration 039 pending): nothing remembered.
  }
  return map;
}

async function loadCompanyIngredientRefs(
  supabase: SupabaseClient,
  companyId: string
): Promise<CatalogIngredientRef[]> {
  const result = await fetchAllRows<CatalogIngredientRef>(() =>
    supabase
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", companyId)
  );
  if (result.error) {
    throw new Error(result.error.message ?? "No pude leer los ingredientes.");
  }
  return result.rows;
}

async function writeManualPrice(input: {
  supabase: SupabaseClient;
  companyId: string;
  ingredient: CatalogIngredientRef;
  unit: string;
  unitCost: number;
}) {
  const currency =
    (await resolveCompanyCurrency(input.supabase, input.companyId)) || "USD";
  const ingredientId = input.ingredient.id;
  const defaultUnit = input.ingredient.default_unit || input.unit;
  await input.supabase
    .from("ingredients")
    .update({ current_unit_cost: input.unitCost, currency })
    .eq("company_id", input.companyId)
    .eq("id", ingredientId);

  const today = new Date().toISOString().slice(0, 10);
  const dated = resolveIngredientPriceDate({
    uploadDate: today,
    kind: "manual",
  });
  const targetUnit = defaultUnit || input.unit;
  const normalized = convertUnitPriceStr(
    input.unitCost,
    input.unit,
    targetUnit
  );
  await input.supabase.from("ingredient_cost_entries").insert({
    company_id: input.companyId,
    ingredient_id: ingredientId,
    source_type: "manual",
    source_id: null,
    cost_date: dated.effective_date,
    effective_date: dated.effective_date,
    date_source: dated.date_source,
    quantity: 1,
    unit: input.unit,
    total_cost: input.unitCost,
    unit_cost: input.unitCost,
    normalized_unit: normalizeUnit(targetUnit) ?? targetUnit,
    normalized_unit_cost: normalized.ok ? normalized.value : input.unitCost,
    currency,
    notes: "Precio corregido en Recetas y costeo",
  });
}
