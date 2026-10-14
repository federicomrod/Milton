// POST /api/restaurant/menu-dishes
//   { action: "sync" }                                  save Milton's grouping
//   { action: "move", odoo_product_id, odoo_name, menu_dish_id?, dish_name? }
//   { action: "exclude", dish_name, menu_dish_id?, variants, excluded }
//
// R1-10 "Plato del menú". Company and user come from auth, never from the
// request. Editing needs the role that may prepare a recipe.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { loadDishEconomicsWith } from "@/lib/restaurant/costing/dish-economics-server";
import {
  MenuDishError,
  excludeDish,
  moveVariant,
  syncMenuDishes,
} from "@/lib/restaurant/menu-dishes/menu-dishes-server";
import { actionableError } from "@/lib/restaurant/actionable-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function productId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim()
    ? raw.trim().slice(0, 160)
    : null;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  if (!actorCanSubmitForApproval(actor)) {
    return NextResponse.json(
      { error: "Tu rol no puede cambiar los platos del menú." },
      { status: 403 }
    );
  }

  const started = Date.now();
  try {
    if (body.action === "sync") {
      const load = await loadDishEconomicsWith(auth.supabase, {
        companyId: auth.companyId,
      });
      if (!load.ok)
        return NextResponse.json({ error: load.error }, { status: 500 });
      if (!load.result.menu_dishes_stored) {
        return NextResponse.json({ ok: true, skipped: "045" });
      }
      const r = await syncMenuDishes(
        auth.supabase,
        auth.companyId,
        load.result.menu_dishes,
        load.result.excluded_menu_dishes
      );
      console.info(`[menu-dishes] sync ${Date.now() - started}ms`, r);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "move") {
      const id = productId(body.odoo_product_id);
      const name = text(body.odoo_name);
      if (!id || !name || (!text(body.menu_dish_id) && !text(body.dish_name))) {
        return NextResponse.json(
          { error: "Faltan datos para mover la variante." },
          { status: 400 }
        );
      }
      const r = await moveVariant(auth.supabase, auth.companyId, {
        odoo_product_id: id,
        odoo_name: name,
        menu_dish_id: text(body.menu_dish_id),
        dish_name: text(body.dish_name),
      });
      console.info(`[menu-dishes] move ${Date.now() - started}ms`);
      return NextResponse.json({ ok: true, ...r });
    }
    if (body.action === "exclude") {
      const dishName = text(body.dish_name);
      const variants = Array.isArray(body.variants)
        ? body.variants
            .map((v) => v as Record<string, unknown>)
            .map((v) => ({
              odoo_product_id: productId(v.odoo_product_id),
              odoo_name: text(v.odoo_name),
            }))
            .filter(
              (v): v is { odoo_product_id: number; odoo_name: string } =>
                v.odoo_product_id !== null && v.odoo_name !== null
            )
        : [];
      if (!dishName || variants.length === 0) {
        return NextResponse.json(
          { error: "Faltan datos para excluir el plato." },
          { status: 400 }
        );
      }
      const r = await excludeDish(auth.supabase, auth.companyId, {
        dish_name: dishName,
        menu_dish_id: text(body.menu_dish_id),
        variants,
        excluded: body.excluded !== false,
      });
      console.info(`[menu-dishes] exclude ${Date.now() - started}ms`);
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
  } catch (err) {
    if (err instanceof MenuDishError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const failure = actionableError(
      err,
      "No pude guardar el cambio del plato.",
      "menu-dishes"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}
