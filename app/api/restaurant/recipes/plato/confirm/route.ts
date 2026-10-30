// POST /api/restaurant/recipes/plato/confirm
// Body: { odoo_product_id, odoo_name?, recipe_version_id?, location_id?,
//         confirmed_how?, yield_confirmed? }
//
// "Aprobar y siguiente" / "Enviar a aprobación y siguiente": confirms the POS
// link, then approves (owner / admin; Milton staff with the client's
// confirmation) or submits (manager) the recipe version. Two separate
// states, each with its own record. Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { confirmPlato } from "@/lib/restaurant/recipe-costing/plato-server";
import { apiDictionary, apiLanguage } from "@/lib/restaurant/api-lang";

const apiMsg = async () => (await apiDictionary()).menu.workspace.api;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: (await apiMsg()).bodyNotJson },
      { status: 400 }
    );
  }
  const odooProductId = Number(body.odoo_product_id);
  if (!Number.isInteger(odooProductId) || odooProductId <= 0) {
    return NextResponse.json(
      { error: (await apiMsg()).platoMissingProduct },
      { status: 400 }
    );
  }
  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  try {
    const result = await confirmPlato({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      odooProductId,
      odooName: typeof body.odoo_name === "string" ? body.odoo_name : undefined,
      recipeVersionId:
        typeof body.recipe_version_id === "string" &&
        body.recipe_version_id.trim()
          ? body.recipe_version_id.trim()
          : null,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      confirmedHow:
        typeof body.confirmed_how === "string" ? body.confirmed_how : null,
      yieldConfirmed: body.yield_confirmed === true,
      lang: await apiLanguage(),
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, link_confirmed: result.link_confirmed ?? false },
        { status: result.status }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[recipes/plato/confirm]", err);
    return NextResponse.json(
      { error: (await apiMsg()).platoSaveFailed },
      { status: 500 }
    );
  }
}
