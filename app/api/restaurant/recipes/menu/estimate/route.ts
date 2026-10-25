// POST /api/restaurant/recipes/menu/estimate
//   Body (JSON): { menu_item_ids?: string[], location_id?: string, limit?: number }
//   → { done, remaining, results: [{ menu_item_id, name, est_cost,
//       est_margin_pct, skipped_reason }] }
// GET  /api/restaurant/recipes/menu/estimate
//   → { available: boolean, eligible: number }
//
// «Estimar con Milton» (issue #212). Each call estimates AT MOST 5 dishes
// (3 AI calls at a time); the client loops in chunks and caps a run at 20.
// An estimate is an overlay: it writes only restaurant_dish_estimates and
// ingredient_price_estimates, never a cost entry, a recipe version or a
// link, and never changes a dish's real status. Owner, admin, manager or
// Milton staff. Company comes from auth.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  ESTIMATE_MAX_RUN,
  ESTIMATE_TABLES_MISSING,
  EstimateTablesMissingError,
  countEligibleMenuDrafts,
  estimateDishes,
} from "@/lib/restaurant/menu-reading/estimate-server";
import { loadDishEstimates } from "@/lib/restaurant/menu-reading/estimate-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const DENIED = "Tu rol no puede preparar recetas.";
const MAX_IDS = 100;

async function guard(): Promise<
  | {
      ok: true;
      auth: Extract<Awaited<ReturnType<typeof authAndCompany>>, { ok: true }>;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await authAndCompany();
  if (!auth.ok) return { ok: false, response: auth.response };
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "recipes.edit", { message: DENIED });
  if (denied) return { ok: false, response: denied };
  return { ok: true, auth };
}

export async function GET() {
  const checked = await guard();
  if (!checked.ok) return checked.response;
  const { supabase, companyId } = checked.auth;
  try {
    const [tables, eligible] = await Promise.all([
      loadDishEstimates(supabase, companyId),
      countEligibleMenuDrafts(supabase, companyId),
    ]);
    return NextResponse.json({
      available: tables.ok,
      eligible,
    });
  } catch {
    return NextResponse.json({ available: false, eligible: 0 });
  }
}

export async function POST(req: NextRequest) {
  const checked = await guard();
  if (!checked.ok) return checked.response;
  const { supabase, companyId, userId } = checked.auth;

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
        { error: "Envía la lista de platos que quieres estimar." },
        { status: 400 }
      );
    }
    menuItemIds = (body.menu_item_ids as string[]).map((id) => id.trim());
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
      locationId,
      limit,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof EstimateTablesMissingError) {
      return NextResponse.json(
        { error: ESTIMATE_TABLES_MISSING },
        { status: 503 }
      );
    }
    console.error("[recipes-menu-estimate]");
    return NextResponse.json(
      { error: "No pude estimar estos platos. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
