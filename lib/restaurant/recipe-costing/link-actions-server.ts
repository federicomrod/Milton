import type { SupabaseClient } from "@supabase/supabase-js";
import {
  TREATMENT_EVIDENCE_KEY,
  classificationFromStored,
  isPosProductLinkState,
  matchPosProductLink,
  unlinkedPosProduct,
  type PosProductClassification,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import { PICKABLE_TREATMENTS } from "@/lib/restaurant/pos-treatments";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  changeLinkResult,
  confirmLinkResult,
  undoConfirmedLinkResult,
} from "./link-actions";
import type { RecipeActor } from "./approval";
import { actorCanConfirmLink, actorCanSubmitForApproval } from "./approval";
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
    classification: classificationFromStored(row.classification),
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

export const TREATMENT_MIGRATION_ERROR =
  "Falta aplicar la migración 040 en la base de datos para guardar cómo se costea cada producto.";
export const TREATMENT_ROLE_ERROR =
  "Solo el dueño, un admin, un gerente o el equipo de Milton puede clasificar productos.";
export const MAX_TREATMENT_ITEMS = 300;

export interface TreatmentItem {
  odoo_product_id: number;
  odoo_name: string;
  treatment: PosProductClassification;
  /** Overrides the call's source for this item. */
  source?: "manual" | "sugerencia";
}

/**
 * A person saves how each product is costed (premise 8). Touches only
 * the classification and its audit note: never the link state, the
 * recipe or a confirmation.
 */
export async function setPosProductTreatments(input: {
  supabase: SupabaseClient;
  companyId: string;
  actor: RecipeActor;
  items: readonly TreatmentItem[];
  locationId?: string | null;
  /** "sugerencia" when the person accepted Milton's suggestion. */
  source: "manual" | "sugerencia";
}): Promise<{ ok: true; saved: number } | { ok: false; error: string }> {
  if (!actorCanSubmitForApproval(input.actor)) {
    return { ok: false, error: TREATMENT_ROLE_ERROR };
  }
  if (input.items.length === 0) return { ok: true, saved: 0 };
  if (input.items.length > MAX_TREATMENT_ITEMS) {
    return { ok: false, error: "Son demasiados productos a la vez." };
  }
  for (const item of input.items) {
    if (!PICKABLE_TREATMENTS.includes(item.treatment)) {
      return { ok: false, error: "Ese tratamiento no existe." };
    }
  }

  const ids = [...new Set(input.items.map((item) => item.odoo_product_id))];
  const { data, error } = await input.supabase
    .from("pos_product_links")
    .select(
      "id, company_id, location_id, odoo_product_id, odoo_name, classification, menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence"
    )
    .eq("company_id", input.companyId)
    .in("odoo_product_id", ids);
  if (error) throw new Error(error.message);
  const links = ((data ?? []) as Record<string, unknown>[])
    .map(asLink)
    .filter((row): row is PosProductLinkRecord => row !== null);

  const at = new Date().toISOString();
  let saved = 0;
  for (const item of input.items) {
    const existing =
      matchPosProductLink(
        links,
        input.companyId,
        item.odoo_product_id,
        input.locationId ?? null
      ) ??
      unlinkedPosProduct({
        company_id: input.companyId,
        odoo_product_id: item.odoo_product_id,
        odoo_name: item.odoo_name.trim() || `Odoo #${item.odoo_product_id}`,
        location_id: input.locationId ?? null,
      });
    if (existing.classification === item.treatment) continue;
    try {
      await persistLink(input.supabase, input.companyId, {
        ...existing,
        classification: item.treatment,
        evidence: {
          ...existing.evidence,
          [TREATMENT_EVIDENCE_KEY]: {
            value: item.treatment,
            previous: existing.classification,
            by: input.actor.user_id,
            at,
            source: item.source ?? input.source,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("pos_product_links_classification_chk")) {
        return { ok: false, error: TREATMENT_MIGRATION_ERROR };
      }
      throw err;
    }
    saved += 1;
  }
  return { ok: true, saved };
}
