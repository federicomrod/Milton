import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveIngredientPriceDate } from "@/lib/restaurant/price-date";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { parseSuggestionEvidence, parseSuggestionLine } from "./evidence";
import { applyInlineLineFix } from "./review";
import { loadPosProductLink } from "./link-actions-server";

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

  if (typeof input.unitCost === "number" && input.unitCost > 0) {
    await writeManualPrice({
      supabase: input.supabase,
      companyId: input.companyId,
      name: next.ingredient_match || next.raw_name,
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

async function writeManualPrice(input: {
  supabase: SupabaseClient;
  companyId: string;
  name: string;
  unit: string;
  unitCost: number;
}) {
  const currency =
    (await resolveCompanyCurrency(input.supabase, input.companyId)) || "USD";
  const { data: existing } = await input.supabase
    .from("ingredients")
    .select("id, default_unit, current_unit_cost")
    .eq("company_id", input.companyId)
    .ilike("name", input.name)
    .limit(1);
  let ingredientId = existing?.[0]?.id as string | undefined;
  let defaultUnit =
    (existing?.[0]?.default_unit as string | null) ?? input.unit;
  if (!ingredientId) {
    const created = await input.supabase
      .from("ingredients")
      .insert({
        company_id: input.companyId,
        name: input.name,
        default_unit: input.unit,
        current_unit_cost: input.unitCost,
        currency,
      })
      .select("id, default_unit")
      .single();
    if (created.error || !created.data) {
      throw new Error(
        created.error?.message ?? "No pude crear el ingrediente."
      );
    }
    ingredientId = String(created.data.id);
    defaultUnit = created.data.default_unit ?? input.unit;
  } else {
    await input.supabase
      .from("ingredients")
      .update({ current_unit_cost: input.unitCost, currency })
      .eq("company_id", input.companyId)
      .eq("id", ingredientId);
  }

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
