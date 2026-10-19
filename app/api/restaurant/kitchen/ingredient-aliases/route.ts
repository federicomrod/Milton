// POST /api/restaurant/kitchen/ingredient-aliases  { raw_name, ingredient_id }
//
// Remembers that a name a cook said means an ingredient of THIS company
// (ingredient_aliases), so the next draft with that name matches exactly.
// The ingredient must belong to the caller's company. Owner / Milton staff.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import {
  isActiveIngredient,
  loadCompanyIngredients,
} from "@/lib/restaurant/ingredient-active";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const denied = await kitchenManagerGuard(auth.companyId, auth.userId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    raw_name?: unknown;
    ingredient_id?: unknown;
  } | null;
  const rawName =
    typeof body?.raw_name === "string"
      ? body.raw_name.trim().replace(/\s+/g, " ")
      : "";
  const ingredientId =
    typeof body?.ingredient_id === "string" ? body.ingredient_id : "";
  if (!rawName || rawName.length > 120 || !ingredientId) {
    return NextResponse.json(
      { error: "Falta el nombre o el ingrediente." },
      { status: 400 }
    );
  }

  const ingredient = (
    await loadCompanyIngredients(auth.supabase, auth.companyId)
  ).find((row) => row.id === ingredientId);
  if (!ingredient) {
    return NextResponse.json(
      { error: "Ese ingrediente no está en tu lista." },
      { status: 400 }
    );
  }
  // A merged-away / archived ingredient is never the target of a name.
  if (!isActiveIngredient(ingredient)) {
    return NextResponse.json(
      { error: "Ese ingrediente ya no está activo." },
      { status: 400 }
    );
  }
  // The ingredient's own name needs no alias.
  if (
    normalizeMatchName(rawName) === normalizeMatchName(String(ingredient.name))
  ) {
    return NextResponse.json({ ok: true, saved: false });
  }

  try {
    await createSupabaseCostWorkbookRepo(auth.supabase).upsertIngredientAlias({
      companyId: auth.companyId,
      aliasName: rawName,
      ingredientId,
      createdBy: auth.userId,
    });
    return NextResponse.json({ ok: true, saved: true });
  } catch (err) {
    console.error(
      "[kitchen-alias] failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude recordar ese nombre." },
      { status: 500 }
    );
  }
}
