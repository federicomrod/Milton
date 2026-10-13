// POST /api/restaurant/recipes/dish-yield
// Body: { odoo_product_id, yield_value, location_id? }
//
// Confirms how many portions a dish's recipe yields. Owner, admin, manager
// or Milton staff. Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { confirmDishYield } from "@/lib/restaurant/recipe-costing/dish-yield-server";

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
  const yieldValue = Number(body.yield_value);
  if (!Number.isInteger(odooProductId) || odooProductId <= 0) {
    return NextResponse.json(
      { error: "Indica el producto de Odoo." },
      { status: 400 }
    );
  }
  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  try {
    const result = await confirmDishYield({
      supabase: auth.supabase,
      companyId: auth.companyId,
      actor,
      odooProductId,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      yieldValue,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recipes/dish-yield]", err);
    return NextResponse.json(
      { error: "No pude guardar el rendimiento." },
      { status: 500 }
    );
  }
}
