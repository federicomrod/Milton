// lib/restaurant/menu-dishes/menu-dishes-server.ts
//
// Writes for menu dishes (R1-10): save Milton's grouping, move a variant,
// exclude a dish. Company comes from auth; every query is company-scoped
// through the caller's RLS client. Milton only fills empty values; a
// variant a person moved, or a confirmed dish, is never overwritten.

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import type { MenuDish } from "./menu-dishes";

export const MIGRATION_045_MISSING =
  "Esta función necesita una actualización de la base de datos (045) que todavía no está aplicada en este ambiente.";

export class MenuDishError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function isMissing045(error: { message?: string; code?: string } | null) {
  if (!error) return false;
  return (
    /menu_dishes/i.test(error.message ?? "") ||
    errorMentionsColumn(error, "menu_dish_id") ||
    error.code === "42P01"
  );
}

function fail(error: { message?: string; code?: string } | null): never {
  if (isMissing045(error)) throw new MenuDishError(MIGRATION_045_MISSING, 409);
  throw new MenuDishError(error?.message ?? "No pude guardar.", 500);
}

/** A stored dish id for this name (created, as suggested, if missing). */
async function dishIdFor(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    name: string;
    category?: string | null;
    source?: MenuDish["source"];
    status: "suggested" | "confirmed";
    basePortionQty?: number | null;
  }
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new MenuDishError("Escribe el nombre del plato.", 400);
  const found = await supabase
    .from("menu_dishes")
    .select("id, name, status")
    .eq("company_id", companyId)
    .ilike("name", name)
    .is("restaurant_id", null)
    .limit(1);
  if (found.error) fail(found.error);
  const hit = found.data?.[0];
  if (hit) {
    if (input.status === "confirmed" && hit.status !== "confirmed") {
      const up = await supabase
        .from("menu_dishes")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", hit.id);
      if (up.error) fail(up.error);
    }
    return String(hit.id);
  }
  const ins = await supabase
    .from("menu_dishes")
    .insert({
      company_id: companyId,
      name,
      category: input.category ?? null,
      source: input.source ?? "name",
      status: input.status,
      base_portion_qty: input.basePortionQty ?? null,
    })
    .select("id")
    .single();
  if (ins.error) fail(ins.error);
  return String(ins.data.id);
}

/** Set a variant's grouping on its company-wide link (created if none). */
async function setVariant(
  supabase: SupabaseClient,
  companyId: string,
  variant: { odoo_product_id: number; odoo_name: string },
  fields: Record<string, unknown>,
  opts: { onlyIfEmpty: boolean }
): Promise<"updated" | "kept" | "created"> {
  const existing = await supabase
    .from("pos_product_links")
    .select("id, location_id, menu_dish_id, excluded_reason")
    .eq("company_id", companyId)
    .eq("odoo_product_id", variant.odoo_product_id);
  if (existing.error) fail(existing.error);
  const rows = existing.data ?? [];
  const row = rows.find((r) => r.location_id == null) ?? rows[0];
  if (row) {
    if (opts.onlyIfEmpty && (row.menu_dish_id || row.excluded_reason)) {
      return "kept";
    }
    const up = await supabase
      .from("pos_product_links")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", row.id);
    if (up.error) fail(up.error);
    return "updated";
  }
  const ins = await supabase.from("pos_product_links").insert({
    company_id: companyId,
    location_id: null,
    odoo_product_id: variant.odoo_product_id,
    odoo_name: variant.odoo_name,
    ...fields,
  });
  if (ins.error) fail(ins.error);
  return "created";
}

/**
 * Save Milton's grouping: every suggested dish is stored and every variant
 * with no dish (and no exclusion) gets one. Idempotent; never overwrites.
 */
export async function syncMenuDishes(
  supabase: SupabaseClient,
  companyId: string,
  dishes: readonly MenuDish[],
  excluded: readonly MenuDish[]
): Promise<{ dishes_created: number; variants_set: number; kept: number }> {
  let created = 0;
  let set = 0;
  let kept = 0;
  for (const dish of dishes) {
    const before = dish.stored;
    const id = dish.stored
      ? dish.id
      : await dishIdFor(supabase, companyId, {
          name: dish.name,
          category: dish.category,
          source: dish.source,
          status: "suggested",
          basePortionQty: dish.base_portion_qty,
        });
    if (!before) created += 1;
    for (const v of dish.variants) {
      const r = await setVariant(
        supabase,
        companyId,
        { odoo_product_id: v.odoo_product_id, odoo_name: v.name },
        {
          menu_dish_id: id,
          portion_qty: v.size,
          side_label: v.side,
          cooking_point: v.cooking_point,
          is_event: v.channel === "eventos",
        },
        { onlyIfEmpty: true }
      );
      if (r === "kept") kept += 1;
      else set += 1;
    }
  }
  for (const dish of excluded) {
    for (const v of dish.variants) {
      const r = await setVariant(
        supabase,
        companyId,
        { odoo_product_id: v.odoo_product_id, odoo_name: v.name },
        { excluded_reason: dish.excluded_reason ?? "excluido" },
        { onlyIfEmpty: true }
      );
      if (r === "kept") kept += 1;
      else set += 1;
    }
  }
  return { dishes_created: created, variants_set: set, kept };
}

/** "Mover variante a otro plato": a person's choice, saved at once. */
export async function moveVariant(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    odoo_product_id: number;
    odoo_name: string;
    /** A stored dish id, or a name for an auto/new dish. */
    menu_dish_id?: string | null;
    dish_name?: string | null;
  }
): Promise<{ menu_dish_id: string }> {
  const id =
    input.menu_dish_id && !input.menu_dish_id.startsWith("auto:")
      ? input.menu_dish_id
      : await dishIdFor(supabase, companyId, {
          name: input.dish_name ?? "",
          status: "confirmed",
        });
  await setVariant(
    supabase,
    companyId,
    { odoo_product_id: input.odoo_product_id, odoo_name: input.odoo_name },
    { menu_dish_id: id, excluded_reason: null },
    { onlyIfEmpty: false }
  );
  return { menu_dish_id: id };
}

/** "Excluir plato" (or put it back): every variant follows the dish. */
export async function excludeDish(
  supabase: SupabaseClient,
  companyId: string,
  input: {
    dish_name: string;
    menu_dish_id?: string | null;
    variants: Array<{ odoo_product_id: number; odoo_name: string }>;
    excluded: boolean;
  }
): Promise<{ menu_dish_id: string }> {
  const id =
    input.menu_dish_id && !input.menu_dish_id.startsWith("auto:")
      ? input.menu_dish_id
      : await dishIdFor(supabase, companyId, {
          name: input.dish_name,
          status: "confirmed",
        });
  const up = await supabase
    .from("menu_dishes")
    .update({
      status: input.excluded ? "excluded" : "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", id);
  if (up.error) fail(up.error);
  for (const v of input.variants) {
    await setVariant(
      supabase,
      companyId,
      v,
      {
        menu_dish_id: id,
        excluded_reason: input.excluded ? "excluido_a_mano" : null,
      },
      { onlyIfEmpty: false }
    );
  }
  return { menu_dish_id: id };
}
