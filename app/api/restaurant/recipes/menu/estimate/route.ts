// POST /api/restaurant/recipes/menu/estimate
//   Body (JSON): { menu_item_ids?: string[],
//                  products?: [{ odoo_product_id, odoo_name }],
//                  location_id?: string, limit?: number }
//   → { done, remaining, results: [{ menu_item_id, name, est_cost,
//       est_margin_pct, skipped_reason }] }
//   `products`: a POS product with no plato yet gets its empty recipe + link
//   first (the same path as «Crear receta»); one that already has a link or a
//   recipe (approved or draft) is reused, so nothing is created twice and
//   nothing existing is touched. A bulk call (no ids) also covers the best
//   selling products that have no plato yet.
// GET  /api/restaurant/recipes/menu/estimate
//   → { available: boolean, eligible: number }
//   eligible = every plato with no recipe (a Confirmado link does not matter)
//   plus the POS food products with no plato yet.
//
// «Estimar con Milton» (issue #212). Each call estimates AT MOST 5 dishes
// (3 AI calls at a time); the client loops in chunks and caps a run at 20.
// An estimate is an overlay: it writes only restaurant_dish_estimates and
// ingredient_price_estimates, never a cost entry, a recipe version or a
// link, and never changes a dish's real status. Owner, admin, manager or
// Milton staff. Company comes from auth.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { toRecipeActor } from "@/lib/restaurant/recipe-costing/approval";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  ESTIMATE_MAX_RUN,
  EstimateTablesMissingError,
  countEstimableDishes,
  countUnlinkedWithoutPlato,
  estimateDishes,
} from "@/lib/restaurant/menu-reading/estimate-server";
import { loadDishEstimates } from "@/lib/restaurant/menu-reading/estimate-store";
import { apiDictionary, apiLanguage } from "@/lib/restaurant/api-lang";
import { menuMsg } from "@/lib/restaurant/menu-reading/messages";

const apiMsg = async () => (await apiDictionary()).menu.workspace.api;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IDS = 100;

async function guard(): Promise<
  | {
      ok: true;
      auth: Extract<Awaited<ReturnType<typeof authAndCompany>>, { ok: true }>;
      actor: ReturnType<typeof toRecipeActor>;
      permission: Awaited<ReturnType<typeof resolveActor>>;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false, response: auth.response };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit", {
    message: (await apiMsg()).roleCannotPrepare,
  });
  if (denied) return { ok: false, response: denied };
  return { ok: true, auth, actor: toRecipeActor(actor), permission: actor };
}

export async function GET() {
  const checked = await guard();
  if (!checked.ok) return checked.response;
  const { supabase, companyId } = checked.auth;
  try {
    const [tables, eligible, needsLink] = await Promise.all([
      loadDishEstimates(supabase, companyId),
      countEstimableDishes(supabase, companyId),
      countUnlinkedWithoutPlato(supabase, companyId),
    ]);
    return NextResponse.json({
      available: tables.ok,
      eligible: eligible + needsLink,
    });
  } catch {
    return NextResponse.json({ available: false, eligible: 0 });
  }
}

export async function POST(req: NextRequest) {
  const checked = await guard();
  if (!checked.ok) return checked.response;
  const { supabase, companyId, userId } = checked.auth;
  const { actor, permission } = checked;

  let body: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // An empty body means «the next dishes».
  }
  let menuItemIds: string[] | undefined;
  if (body.menu_item_ids !== undefined) {
    if (
      !Array.isArray(body.menu_item_ids) ||
      body.menu_item_ids.length > MAX_IDS ||
      body.menu_item_ids.some((id) => typeof id !== "string" || !id.trim())
    ) {
      return NextResponse.json(
        { error: (await apiMsg()).estimateSendDishes },
        { status: 400 }
      );
    }
    menuItemIds = (body.menu_item_ids as string[]).map((id) => id.trim());
  }
  let products:
    | Array<{ odoo_product_id: number; odoo_name: string }>
    | undefined;
  if (body.products !== undefined) {
    const raw = body.products;
    const valid =
      Array.isArray(raw) &&
      raw.length <= MAX_IDS &&
      raw.every(
        (p) =>
          p &&
          typeof p === "object" &&
          Number.isInteger(
            (p as { odoo_product_id?: unknown }).odoo_product_id
          ) &&
          (p as { odoo_product_id: number }).odoo_product_id > 0 &&
          typeof (p as { odoo_name?: unknown }).odoo_name === "string" &&
          (p as { odoo_name: string }).odoo_name.trim() !== ""
      );
    if (!valid) {
      return NextResponse.json(
        { error: (await apiMsg()).estimateSendProducts },
        { status: 400 }
      );
    }
    products = (
      raw as Array<{ odoo_product_id: number; odoo_name: string }>
    ).map((p) => ({
      odoo_product_id: p.odoo_product_id,
      odoo_name: p.odoo_name.trim(),
    }));
  }
  // A request that can CREATE recipes and links (products given, or a bulk
  // run that links unlinked products) needs the same permission as «Crear
  // receta». An estimate of existing platos (menu_item_ids) does not.
  if (products !== undefined || menuItemIds === undefined) {
    const noLink = requireCapability(permission, "links.confirm");
    if (noLink) return noLink;
  }
  const locationId =
    typeof body.location_id === "string" && body.location_id.trim()
      ? body.location_id.trim()
      : null;
  const limit =
    typeof body.limit === "number" && Number.isFinite(body.limit)
      ? Math.min(Math.max(1, Math.floor(body.limit)), ESTIMATE_MAX_RUN)
      : ESTIMATE_MAX_RUN;

  try {
    const result = await estimateDishes(supabase, {
      companyId,
      userId,
      menuItemIds,
      products,
      actor,
      locationId,
      limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EstimateTablesMissingError) {
      return NextResponse.json(
        { error: menuMsg(await apiLanguage(), "estimateTablesMissing") },
        { status: 503 }
      );
    }
    console.error("[recipes-menu-estimate]");
    return NextResponse.json(
      { error: (await apiMsg()).estimateFailed },
      { status: 500 }
    );
  }
}
