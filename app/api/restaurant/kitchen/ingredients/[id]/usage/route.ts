// GET /api/restaurant/kitchen/ingredients/:id/usage
//
// How many dishes use this ingredient (the same `dishesUsingIngredient` as
// Ingredientes and Costos), for the warning «Esto cambia el precio de X en
// todos los platos (N platos)». The ingredient must belong to the caller's
// company.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { dishesUsingIngredient } from "@/lib/restaurant/costing/dish-economics";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const d = await apiDictionary();
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const { data: ingredient } = await auth.supabase
    .from("ingredients")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("id", id)
    .maybeSingle();
  if (!ingredient) {
    return NextResponse.json(
      { error: d.kitchen.api.ingredientNotInList },
      { status: 404 }
    );
  }

  const economics = await loadDishEconomics(auth.companyId, null, null, null);
  const uses = economics.ok ? dishesUsingIngredient(economics.result, id) : [];
  return NextResponse.json({
    dishes: uses.length,
    names: uses.slice(0, 5).map(({ dish }) => dish.name),
  });
}
