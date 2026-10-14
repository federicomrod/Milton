// lib/restaurant/menu-dishes/menu-dishes-server.ts
//
// Writes for menu dishes (R1-10): save Milton's grouping, move a variant,
// exclude a dish. Company comes from auth; every query is company-scoped
// through the caller's RLS client. Milton only fills empty values; a
// variant a person moved, or a confirmed dish, is never overwritten.
//
// A dish id from the client is never trusted: it must be a dish of the
// caller's company, and a restaurant-only dish only takes variants that
// have a link in that restaurant (the database also rejects a dish of
// another company, 045).

import type { SupabaseClient } from "@supabase/supabase-js";
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import type { MenuDish } from "./menu-dishes";

export const MIGRATION_045_MISSING =
  "Esta función necesita una actualización de la base de datos (045) que todavía no está aplicada en este ambiente.";

export const DISH_NOT_FOUND = "Ese plato no existe en tu menú.";
export const DISH_OTHER_RESTAURANT =
  "Ese plato es solo de un restaurante y esta variante no se vende ahí.";

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
    error.code === "42P01" ||
    error.code === "PGRST202"
  );
}

function fail(error: { message?: string; code?: string } | null): never {
  if (isMissing045(error)) throw new MenuDishError(MIGRATION_045_MISSING, 409);
  throw new MenuDishError(error?.message ?? "No pude guardar.", 500);
}

/** ilike matches a literal name (no % or _ wildcards). */
function literal(name: string): string {
  return name.replace(/[\\%_]/g, (c) => `\\${c}`);
}

interface OwnedDish {
  id: string;
  name: string;
  restaurant_id: string | null;
  status: string;
}

/** A dish of this company by id, or a 404 (another company's id too). */
export async function ownedDish(
  supabase: SupabaseClient,
  companyId: string,
  id: string
): Promise<OwnedDish> {
  const res = await supabase
    .from("menu_dishes")
    .select("id, name, restaurant_id, status")
    .eq("company_id", companyId)
    .eq("id", id)
    .limit(1);
  if (res.error) fail(res.error);
  const hit = res.data?.[0] as OwnedDish | undefined;
  if (!hit) throw new MenuDishError(DISH_NOT_FOUND, 404);
  return hit;
}

/**
 * A stored dish with this name: shared or restaurant-only (the shared one
 * first). Created as a shared dish when there is none.
 */
async function dishByName(
  supabase: SupabaseClient,
  companyId: string,
  input: { name: string; status: "suggested" | "confirmed" }
): Promise<OwnedDish> {
  const name = input.name.trim();
  if (!name) throw new MenuDishError("Escribe el nombre del plato.", 400);
  const found = await supabase
    .from("menu_dishes")
    .select("id, name, restaurant_id, status")
    .eq("company_id", companyId)
    .ilike("name", literal(name))
    .limit(10);
  if (found.error) fail(found.error);
  const rows = (found.data ?? []) as OwnedDish[];
  const hit = rows.find((d) => d.restaurant_id == null) ?? rows[0];
  if (hit) {
    if (input.status === "confirmed" && hit.status === "suggested") {
      const up = await supabase
        .from("menu_dishes")
        .update({ status: "confirmed", updated_at: new Date().toISOString() })
        .eq("company_id", companyId)
        .eq("id", hit.id);
      if (up.error) fail(up.error);
    }
    return hit;
  }
  const ins = await supabase
    .from("menu_dishes")
    .insert({
      company_id: companyId,
      name,
      source: "name",
      status: input.status,
    })
    .select("id, name, restaurant_id, status")
    .single();
  if (ins.error) fail(ins.error);
  return ins.data as OwnedDish;
}

/** The dish a request names: a validated stored id, or a name. */
async function targetDish(
  supabase: SupabaseClient,
  companyId: string,
  input: { menu_dish_id?: string | null; dish_name?: string | null }
): Promise<OwnedDish> {
  const id = input.menu_dish_id?.trim();
  if (id && !id.startsWith("auto:") && !id.startsWith("nuevo:")) {
    return ownedDish(supabase, companyId, id);
  }
  return dishByName(supabase, companyId, {
    name: input.dish_name ?? "",
    status: "confirmed",
  });
}

interface LinkRow {
  id: string;
  odoo_product_id: number;
  location_id: string | null;
}

/**
 * Point these products at a dish. A shared dish takes every link of each
 * product (a product with no link gets a company-wide one); a
 * restaurant-only dish takes only that restaurant's links, and a product
 * with no link there is refused. Two requests, whatever the count.
 */
async function assignProducts(
  supabase: SupabaseClient,
  companyId: string,
  dish: OwnedDish,
  products: ReadonlyArray<{ odoo_product_id: number; odoo_name: string }>,
  fields: Record<string, unknown>
): Promise<void> {
  const ids = [...new Set(products.map((p) => p.odoo_product_id))];
  const res = await supabase
    .from("pos_product_links")
    .select("id, odoo_product_id, location_id")
    .eq("company_id", companyId)
    .in("odoo_product_id", ids);
  if (res.error) fail(res.error);
  const links = (res.data ?? []) as LinkRow[];
  const usable = dish.restaurant_id
    ? links.filter((l) => l.location_id === dish.restaurant_id)
    : links;
  const covered = new Set(usable.map((l) => l.odoo_product_id));
  const missing = products.filter((p) => !covered.has(p.odoo_product_id));
  if (dish.restaurant_id && missing.length > 0) {
    throw new MenuDishError(DISH_OTHER_RESTAURANT, 400);
  }
  const now = new Date().toISOString();
  if (usable.length > 0) {
    const up = await supabase
      .from("pos_product_links")
      .update({ ...fields, menu_dish_id: dish.id, updated_at: now })
      .eq("company_id", companyId)
      .in(
        "id",
        usable.map((l) => l.id)
      );
    if (up.error) fail(up.error);
  }
  if (missing.length > 0) {
    const ins = await supabase.from("pos_product_links").insert(
      missing.map((p) => ({
        company_id: companyId,
        location_id: null,
        odoo_product_id: p.odoo_product_id,
        odoo_name: p.odoo_name,
        ...fields,
        menu_dish_id: dish.id,
      }))
    );
    if (ins.error) fail(ins.error);
  }
}

export interface SyncResult {
  dishes_created: number;
  variants_set: number;
  /** Variants already grouped (by a person or an earlier save): untouched. */
  kept: number;
  /** Requests sent to the database for the writes. */
  write_requests: number;
}

/**
 * Save Milton's grouping for the variants that have none yet (no dish and
 * no exclusion on their link). Variants already grouped are not sent.
 * Writes: at most one read and one insert for new dishes, then one call
 * that fills the variants (045's menu_dishes_fill_variants), which skips
 * any link a person changed in the meantime.
 */
export async function syncMenuDishes(
  supabase: SupabaseClient,
  companyId: string,
  dishes: readonly MenuDish[],
  excluded: readonly MenuDish[]
): Promise<SyncResult> {
  let requests = 0;
  const pending = dishes.filter((d) => d.variants.some((v) => !v.saved));
  const pendingExcluded = excluded.filter((d) =>
    d.variants.some((v) => !v.saved)
  );
  const kept = [...dishes, ...excluded]
    .flatMap((d) => d.variants)
    .filter((v) => v.saved).length;
  if (pending.length === 0 && pendingExcluded.length === 0) {
    return { dishes_created: 0, variants_set: 0, kept, write_requests: 0 };
  }

  // 1) Ids for Milton's new dishes (one read, one bulk insert).
  const idOf = new Map<string, string>();
  for (const d of pending) if (d.stored) idOf.set(d.id, d.id);
  const unsaved = pending.filter((d) => !d.stored);
  let created = 0;
  if (unsaved.length > 0) {
    const readShared = async () => {
      requests += 1;
      const res = await supabase
        .from("menu_dishes")
        .select("id, name")
        .eq("company_id", companyId)
        .is("restaurant_id", null);
      if (res.error) fail(res.error);
      return new Map(
        (res.data ?? []).map((r) => [
          String(r.name).toLowerCase(),
          String(r.id),
        ])
      );
    };
    let byName = await readShared();
    const toInsert = [
      ...new Map(
        unsaved
          .filter((d) => !byName.has(d.name.trim().toLowerCase()))
          .map((d) => [d.name.trim().toLowerCase(), d])
      ).values(),
    ];
    if (toInsert.length > 0) {
      requests += 1;
      const ins = await supabase
        .from("menu_dishes")
        .insert(
          toInsert.map((d) => ({
            company_id: companyId,
            name: d.name.trim(),
            category: d.category,
            source: d.source,
            status: "suggested",
            base_portion_qty: d.base_portion_qty,
          }))
        )
        .select("id, name");
      if (ins.error) {
        // Someone saved the same dish meanwhile: read the ids again.
        if (ins.error.code !== "23505") fail(ins.error);
        byName = await readShared();
      } else {
        created = ins.data?.length ?? 0;
        for (const r of ins.data ?? []) {
          byName.set(String(r.name).toLowerCase(), String(r.id));
        }
      }
    }
    for (const d of unsaved) {
      const id = byName.get(d.name.trim().toLowerCase());
      if (id) idOf.set(d.id, id);
    }
  }

  // 2) Fill the variants in one call, only where still empty.
  const seen = new Set<number>();
  const rows: Array<Record<string, unknown>> = [];
  for (const d of pending) {
    const id = idOf.get(d.id);
    if (!id) continue;
    for (const v of d.variants) {
      if (v.saved || seen.has(v.odoo_product_id)) continue;
      seen.add(v.odoo_product_id);
      rows.push({
        odoo_product_id: v.odoo_product_id,
        odoo_name: v.name,
        menu_dish_id: id,
        portion_qty: v.size,
        side_label: v.side,
        cooking_point: v.cooking_point,
        is_event: v.channel === "eventos",
        excluded_reason: null,
      });
    }
  }
  for (const d of pendingExcluded) {
    for (const v of d.variants) {
      if (v.saved || seen.has(v.odoo_product_id)) continue;
      seen.add(v.odoo_product_id);
      rows.push({
        odoo_product_id: v.odoo_product_id,
        odoo_name: v.name,
        menu_dish_id: null,
        portion_qty: null,
        side_label: null,
        cooking_point: null,
        is_event: false,
        excluded_reason: d.excluded_reason ?? "excluido",
      });
    }
  }
  let set = 0;
  if (rows.length > 0) {
    requests += 1;
    const res = await supabase.rpc("menu_dishes_fill_variants", {
      p_company_id: companyId,
      p_rows: rows,
    });
    if (res.error) fail(res.error);
    const out = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | { filled?: number; created?: number }
      | undefined;
    set = Number(out?.filled ?? 0) + Number(out?.created ?? 0);
  }
  return {
    dishes_created: created,
    variants_set: set,
    kept: kept + (rows.length - set),
    write_requests: requests,
  };
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
  const dish = await targetDish(supabase, companyId, input);
  if (dish.status === "excluded") {
    throw new MenuDishError(
      "Ese plato está excluido. Vuelve a incluirlo antes de moverle variantes.",
      400
    );
  }
  await assignProducts(
    supabase,
    companyId,
    dish,
    [{ odoo_product_id: input.odoo_product_id, odoo_name: input.odoo_name }],
    { excluded_reason: null }
  );
  return { menu_dish_id: dish.id };
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
  const dish = await targetDish(supabase, companyId, {
    menu_dish_id: input.menu_dish_id,
    dish_name: input.dish_name,
  });
  // Validate the variants before the dish changes status.
  await assignProducts(supabase, companyId, dish, input.variants, {
    excluded_reason: input.excluded ? "excluido_a_mano" : null,
  });
  const up = await supabase
    .from("menu_dishes")
    .update({
      status: input.excluded ? "excluded" : "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("id", dish.id);
  if (up.error) fail(up.error);
  return { menu_dish_id: dish.id };
}
