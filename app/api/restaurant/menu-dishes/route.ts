// POST /api/restaurant/menu-dishes
//   { action: "sync" }                                  "Guardar agrupación"
//   { action: "move", odoo_product_id, odoo_name, menu_dish_id?, dish_name? }
//   { action: "exclude", dish_name, menu_dish_id?, variants, excluded }
//
// R1-10 "Plato del menú". Company and user come from auth, never from the
// request. Editing needs the role that may prepare a recipe.

import { after, NextRequest, NextResponse } from "next/server";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import {
  MenuDishError,
  excludeDish,
  moveVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes-server";
import { saveMenuGrouping } from "@/lib/restaurant/menu-dishes/save-grouping";
import { syncAutoGroups } from "@/lib/restaurant/groups/item-groups";
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
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "menu.manage", {
    message: api.roleMenuDishes,
  });
  if (denied) return denied;

  // R1-15b: after a save, the Plato del menú level of the groups follows (048;
  // insert-only, after the response, a no-op until 048 is applied).
  const followWithAutoGroups = () =>
    after(async () => {
      try {
        await syncAutoGroups(auth.supabase, auth.companyId);
      } catch (err) {
        console.error("[menu-dishes] auto groups:", err);
      }
    });

  const started = Date.now();
  try {
    if (body.action === "sync") {
      const r = await saveMenuGrouping(auth.supabase, auth.companyId);
      console.info(`[menu-dishes] sync ${Date.now() - started}ms`, r);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
      followWithAutoGroups();
      return NextResponse.json(r);
    }
    if (body.action === "move") {
      const id = productId(body.odoo_product_id);
      const name = text(body.odoo_name);
      if (!id || !name || (!text(body.menu_dish_id) && !text(body.dish_name))) {
        return NextResponse.json(
          { error: api.missingMoveData },
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
      followWithAutoGroups();
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
          { error: api.missingExcludeData },
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
      followWithAutoGroups();
      return NextResponse.json({ ok: true, ...r });
    }
    return NextResponse.json({ error: api.unknownAction }, { status: 400 });
  } catch (err) {
    if (err instanceof MenuDishError) {
      return NextResponse.json(
        { error: err.key ? api[err.key] : err.message },
        { status: err.status }
      );
    }
    const failure = actionableError(err, api.saveDishChange, "menu-dishes");
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
}
