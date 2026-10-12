import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { approveRecipeVersion } from "@/lib/restaurant/recipe-costing/approval-server";

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
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const recipeVersionId =
    typeof body.recipe_version_id === "string"
      ? body.recipe_version_id.trim()
      : "";
  if (!recipeVersionId) {
    return NextResponse.json(
      { error: "Falta recipe_version_id." },
      { status: 400 }
    );
  }
  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  try {
    const result = await approveRecipeVersion({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      recipeVersionId,
      odooProductId:
        typeof body.odoo_product_id === "number"
          ? body.odoo_product_id
          : Number(body.odoo_product_id) || undefined,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      confirmedHow:
        typeof body.confirmed_how === "string" ? body.confirmed_how : null,
      yieldConfirmed: body.yield_confirmed === true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ approved: true });
  } catch (err) {
    console.error("[recipes/approve]", err);
    return NextResponse.json(
      { error: "No pude aprobar la receta." },
      { status: 500 }
    );
  }
}
