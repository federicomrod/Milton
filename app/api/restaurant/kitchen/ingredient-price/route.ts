// POST /api/restaurant/kitchen/ingredient-price  { ingredient_id, unit, unit_cost }
//
// The inline «Editar precio» of Revisar receta and of the Cocina card. A thin
// wrapper over the ONE pricing path (`setIngredientPrice` → store.addCostEntry,
// the same as the recipe editor's «set_price», #280): a dated price entry that
// every dish reads. The ingredient must belong to the caller's company.
// Owner / Milton staff only.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { setIngredientPrice } from "@/lib/restaurant/recipe-costing/editor-service";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    draft_id?: unknown;
    ingredient_id?: unknown;
    unit?: unknown;
    unit_cost?: unknown;
  } | null;
  const denied = await kitchenManagerGuard(auth.companyId, auth.userId, {
    draftId: typeof body?.draft_id === "string" ? body.draft_id : null,
  });
  if (denied) return denied;
  const ingredientId =
    typeof body?.ingredient_id === "string" ? body.ingredient_id : "";
  if (!ingredientId) {
    return NextResponse.json(
      { error: "Falta el ingrediente." },
      { status: 400 }
    );
  }

  const { data: ingredient } = await auth.supabase
    .from("ingredients")
    .select("id, default_unit")
    .eq("company_id", auth.companyId)
    .eq("id", ingredientId)
    .maybeSingle();

  try {
    const store = createSupabaseEditorStore(auth.supabase);
    const result = await setIngredientPrice(
      store,
      auth.companyId,
      { ingredientId, unit: body?.unit, unitCost: body?.unit_cost },
      ingredient
        ? { default_unit: (ingredient.default_unit as string | null) ?? null }
        : undefined
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, conversion: result.conversion },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[kitchen-ingredient-price] failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude guardar el precio." },
      { status: 500 }
    );
  }
}
