// POST /api/restaurant/pos/links/resale
// Body: { odoo_product_id, odoo_name, ingredient_id, quantity, unit,
//         location_id? }
//
// Reventa in one step: marks the product as reventa and creates a draft
// one-line recipe (the item you buy). The link stays a suggestion and the
// recipe still needs approval. Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { startResaleRecipe } from "@/lib/restaurant/recipe-costing/resale-server";

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
  const odooProductId = Number(body.odoo_product_id);
  const odooName = typeof body.odoo_name === "string" ? body.odoo_name : "";
  const ingredientId =
    typeof body.ingredient_id === "string" ? body.ingredient_id.trim() : "";
  const quantity = Number(body.quantity);
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  if (
    !Number.isInteger(odooProductId) ||
    odooProductId <= 0 ||
    !odooName.trim() ||
    !ingredientId ||
    !unit
  ) {
    return NextResponse.json(
      { error: "Indica el producto de Odoo, qué compras y la unidad." },
      { status: 400 }
    );
  }

  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  try {
    const result = await startResaleRecipe({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      odooProductId,
      odooName,
      ingredientId,
      quantity,
      unit,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    return NextResponse.json({
      menu_item_id: result.menu_item_id,
      state: result.state,
    });
  } catch (err) {
    console.error("[pos/links/resale]", err);
    return NextResponse.json(
      { error: "No pude crear el costo de reventa." },
      { status: 500 }
    );
  }
}
