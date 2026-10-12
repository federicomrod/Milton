import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isPosProductClassification,
  isPosProductLinkState,
  matchPosProductLink,
  unlinkedPosProduct,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  changeLinkResult,
  confirmLinkResult,
  undoConfirmedLinkResult,
} from "./link-actions";
import type { RecipeActor } from "./approval";
import { actorCanConfirmLink } from "./approval";
import { isConfirmedHow } from "./copy";

function asLink(row: Record<string, unknown>): PosProductLinkRecord | null {
  const odooProductId = row.odoo_product_id;
  if (typeof odooProductId !== "number" || !Number.isInteger(odooProductId)) {
    return null;
  }
  if (typeof row.company_id !== "string" || typeof row.odoo_name !== "string") {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    company_id: row.company_id,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    odoo_product_id: odooProductId,
    odoo_name: row.odoo_name,
    classification: isPosProductClassification(row.classification)
      ? row.classification
      : "por_clasificar",
    menu_item_id:
      typeof row.menu_item_id === "string" ? row.menu_item_id : null,
    link_state: isPosProductLinkState(row.link_state)
      ? row.link_state
      : "sin_vincular",
    confirmed_by:
      typeof row.confirmed_by === "string" ? row.confirmed_by : null,
    confirmed_at:
      typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    confirmed_how:
      typeof row.confirmed_how === "string" ? row.confirmed_how : null,
    evidence:
      row.evidence &&
      typeof row.evidence === "object" &&
      !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {},
  };
}

export async function loadPosProductLink(
  supabase: SupabaseClient,
  companyId: string,
  odooProductId: number,
  locationId?: string | null
): Promise<PosProductLinkRecord | null> {
  const { data, error } = await supabase
    .from("pos_product_links")
    .select(
      "id, company_id, location_id, odoo_product_id, odoo_name, classification, menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence"
    )
    .eq("company_id", companyId)
    .eq("odoo_product_id", odooProductId);
  if (error) throw new Error(error.message);
  const links = ((data ?? []) as Record<string, unknown>[])
    .map(asLink)
    .filter((row): row is PosProductLinkRecord => row !== null);
  return matchPosProductLink(
    links,
    companyId,
    odooProductId,
    locationId ?? null
  );
}

async function persistLink(
  supabase: SupabaseClient,
  companyId: string,
  link: PosProductLinkRecord
): Promise<PosProductLinkRecord> {
  const payload = {
    company_id: companyId,
    location_id: link.location_id,
    odoo_product_id: link.odoo_product_id,
    odoo_name: link.odoo_name,
    classification: link.classification,
    menu_item_id: link.menu_item_id,
    link_state: link.link_state,
    confirmed_by: link.confirmed_by,
    confirmed_at: link.confirmed_at,
    confirmed_how: link.confirmed_how,
    evidence: link.evidence,
    updated_at: new Date().toISOString(),
  };
  if (link.id) {
    const { error } = await supabase
      .from("pos_product_links")
      .update(payload)
      .eq("company_id", companyId)
      .eq("id", link.id);
    if (error) throw new Error(error.message);
    return link;
  }
  const { data, error } = await supabase
    .from("pos_product_links")
    .insert(payload)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "No pude guardar el vínculo.");
  }
  return { ...link, id: String(data.id) };
}

function confirmationFromActor(
  actor: RecipeActor,
  how: string | null | undefined
): { confirmed_by: string; confirmed_at: string; confirmed_how: string } {
  return {
    confirmed_by: actor.user_id,
    confirmed_at: new Date().toISOString(),
    confirmed_how: (how?.trim() ||
      (actorNeedsSelfHow(actor) ? "" : "en_pantalla")) as string,
  };
}

function actorNeedsSelfHow(actor: RecipeActor): boolean {
  return (
    actor.is_milton_staff && actor.role !== "owner" && actor.role !== "admin"
  );
}

export async function confirmPosLinkForCompany(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  odooProductId: number;
  odooName?: string;
  locationId?: string | null;
  confirmedHow?: string | null;
  menuItemId?: string | null;
}): Promise<
  { ok: true; link: PosProductLinkRecord } | { ok: false; error: string }
> {
  const how = input.confirmedHow?.trim() ?? "";
  if (how && !isConfirmedHow(how)) {
    return { ok: false, error: "Indica cómo confirmó el cliente." };
  }
  const confirmation = confirmationFromActor(input.actor, how || "en_pantalla");
  const allowed = actorCanConfirmLink(input.actor, confirmation);
  if (!allowed.ok) return allowed;

  const existing =
    (await loadPosProductLink(
      input.supabase,
      input.companyId,
      input.odooProductId,
      input.locationId
    )) ??
    unlinkedPosProduct({
      company_id: input.companyId,
      odoo_product_id: input.odooProductId,
      odoo_name: input.odooName ?? `Odoo #${input.odooProductId}`,
      location_id: input.locationId ?? null,
    });
  const base = input.menuItemId
    ? { ...existing, menu_item_id: input.menuItemId }
    : existing;
  if (!base.menu_item_id) {
    return {
      ok: false,
      error: "Elige o crea una receta antes de confirmar el vínculo.",
    };
  }
  const next = confirmLinkResult(base, confirmation);
  if (!next.ok) return next;
  const saved = await persistLink(input.supabase, input.companyId, next.link);
  return { ok: true, link: saved };
}

export async function changePosLinkForCompany(input: {
  supabase: SupabaseClient;
  companyId: string;
  odooProductId: number;
  odooName?: string;
  locationId?: string | null;
  menuItemId: string;
}): Promise<
  { ok: true; link: PosProductLinkRecord } | { ok: false; error: string }
> {
  const { data: menu, error } = await input.supabase
    .from("menu_items")
    .select("id, name")
    .eq("company_id", input.companyId)
    .eq("id", input.menuItemId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!menu) {
    return { ok: false, error: "Esa receta no es de tu restaurante." };
  }
  const existing =
    (await loadPosProductLink(
      input.supabase,
      input.companyId,
      input.odooProductId,
      input.locationId
    )) ??
    unlinkedPosProduct({
      company_id: input.companyId,
      odoo_product_id: input.odooProductId,
      odoo_name:
        input.odooName ?? String(menu.name ?? `Odoo #${input.odooProductId}`),
      location_id: input.locationId ?? null,
    });
  const next = changeLinkResult(existing, {
    menu_item_id: input.menuItemId,
    evidence: { source: "manual_pick", block_name: menu.name },
  });
  if (!next.ok) return next;
  const saved = await persistLink(input.supabase, input.companyId, next.link);
  return { ok: true, link: saved };
}

export async function createRecipeAndLink(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  odooProductId: number;
  odooName: string;
  locationId?: string | null;
}): Promise<
  | { ok: true; menu_item_id: string; link: PosProductLinkRecord }
  | { ok: false; error: string }
> {
  const name = input.odooName.trim();
  if (!name) return { ok: false, error: "Falta el nombre del producto." };
  const currency =
    (await resolveCompanyCurrency(input.supabase, input.companyId)) || "USD";
  const created = await input.supabase
    .from("menu_items")
    .insert({
      company_id: input.companyId,
      name,
      selling_price: 0,
      currency,
    })
    .select("id")
    .single();
  if (created.error || !created.data) {
    return {
      ok: false,
      error: created.error?.message ?? "No pude crear la receta.",
    };
  }
  const menuItemId = String(created.data.id);
  const recipe = await input.supabase
    .from("recipes")
    .insert({
      company_id: input.companyId,
      menu_item_id: menuItemId,
      name,
      status: "draft",
      serving_quantity: 1,
      serving_unit: "portion",
      source_type: "manual",
    })
    .select("id")
    .single();
  if (recipe.error || !recipe.data) {
    return {
      ok: false,
      error:
        recipe.error?.message ??
        "Creé el platillo pero no pude guardar la receta.",
    };
  }
  await input.supabase.from("recipe_versions").insert({
    company_id: input.companyId,
    recipe_id: recipe.data.id,
    menu_item_id: menuItemId,
    version_number: 1,
    status: "in_review",
    effective_date: null,
    source_type: "manual",
    notes: "Borrador",
  });
  const existing =
    (await loadPosProductLink(
      input.supabase,
      input.companyId,
      input.odooProductId,
      input.locationId
    )) ??
    unlinkedPosProduct({
      company_id: input.companyId,
      odoo_product_id: input.odooProductId,
      odoo_name: name,
      location_id: input.locationId ?? null,
    });
  const next = changeLinkResult(existing, {
    menu_item_id: menuItemId,
    evidence: { source: "create_recipe", block_name: name },
  });
  if (!next.ok) return next;
  const saved = await persistLink(input.supabase, input.companyId, next.link);
  return { ok: true, menu_item_id: menuItemId, link: saved };
}

export async function undoConfirmedPosLink(input: {
  supabase: SupabaseClient;
  companyId: string;
  odooProductId: number;
  locationId?: string | null;
}): Promise<
  { ok: true; link: PosProductLinkRecord } | { ok: false; error: string }
> {
  const existing = await loadPosProductLink(
    input.supabase,
    input.companyId,
    input.odooProductId,
    input.locationId
  );
  if (!existing) {
    return { ok: false, error: "No hay un vínculo Confirmado que deshacer." };
  }
  const next = undoConfirmedLinkResult(existing);
  if (!next.ok) return next;
  const saved = await persistLink(input.supabase, input.companyId, next.link);
  return { ok: true, link: saved };
}
