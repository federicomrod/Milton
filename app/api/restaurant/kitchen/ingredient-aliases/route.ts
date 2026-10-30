// POST /api/restaurant/kitchen/ingredient-aliases  { raw_name, ingredient_id }
//
// Remembers that a name a cook said means an ingredient of THIS company
// (ingredient_aliases), so the next draft with that name matches exactly.
// INSERT ONLY: an existing alias (also one from a merge or an import) is never
// repointed; the answer is { saved: false, existing }.
// The ingredient must belong to the caller's company. Owner / Milton staff.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import {
  aliasKeyFor,
  createSupabaseCostWorkbookRepo,
} from "@/lib/restaurant/cost-workbook/repo";
import {
  isActiveIngredient,
  loadCompanyIngredients,
} from "@/lib/restaurant/ingredient-active";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const d = await apiDictionary();
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const body = (await req.json().catch(() => null)) as {
    draft_id?: unknown;
    raw_name?: unknown;
    ingredient_id?: unknown;
  } | null;
  const denied = await kitchenManagerGuard(auth.companyId, auth.userId, {
    draftId: typeof body?.draft_id === "string" ? body.draft_id : null,
  });
  if (denied) return denied;
  const rawName =
    typeof body?.raw_name === "string"
      ? body.raw_name.trim().replace(/\s+/g, " ")
      : "";
  const ingredientId =
    typeof body?.ingredient_id === "string" ? body.ingredient_id : "";
  if (!rawName || rawName.length > 120 || !ingredientId) {
    return NextResponse.json(
      { error: d.kitchen.api.aliasFieldsMissing },
      { status: 400 }
    );
  }

  const ingredient = (
    await loadCompanyIngredients(auth.supabase, auth.companyId)
  ).find((row) => row.id === ingredientId);
  if (!ingredient) {
    return NextResponse.json(
      { error: d.kitchen.api.ingredientNotInList },
      { status: 400 }
    );
  }
  // A merged-away / archived ingredient is never the target of a name.
  if (!isActiveIngredient(ingredient)) {
    return NextResponse.json(
      { error: d.kitchen.api.ingredientInactive },
      { status: 400 }
    );
  }
  const active = (
    await loadCompanyIngredients(auth.supabase, auth.companyId)
  ).filter(isActiveIngredient);
  const key = normalizeMatchName(rawName);
  // No alias when the words ARE the name of an active ingredient (its own, or
  // another one): the name already says what it means.
  if (
    normalizeMatchName(String(ingredient.name)) === key ||
    active.some((row) => normalizeMatchName(row.name) === key)
  ) {
    return NextResponse.json({ ok: true, saved: false });
  }

  try {
    // INSERT ONLY. ingredient_aliases is shared with the Excel import, the menu
    // reader and the ingredient merges (a merge points the loser's name at the
    // survivor, and "undo merge" relies on it): a name that already has an alias
    // is never repointed from here.
    const aliasKey = aliasKeyFor(rawName);
    const already = (
      await createSupabaseCostWorkbookRepo(auth.supabase).listIngredientAliases(
        auth.companyId
      )
    ).find((row) => row.alias_key === aliasKey);
    const existingResponse = (ingredientId: string) => {
      const target = active.find((row) => row.id === ingredientId);
      return NextResponse.json({
        ok: true,
        saved: false,
        existing: {
          id: ingredientId,
          name: target?.name ?? "",
        },
      });
    };
    if (already) return existingResponse(already.ingredient_id);

    const { error } = await auth.supabase.from("ingredient_aliases").insert({
      company_id: auth.companyId,
      alias_key: aliasKey,
      alias_name: rawName,
      ingredient_id: ingredientId,
      created_by: auth.userId,
    });
    if (error) {
      // Somebody saved the same name a moment ago: keep theirs.
      if (error.code === "23505") {
        const winner = (
          await createSupabaseCostWorkbookRepo(
            auth.supabase
          ).listIngredientAliases(auth.companyId)
        ).find((row) => row.alias_key === aliasKey);
        if (winner) return existingResponse(winner.ingredient_id);
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, saved: true });
  } catch (err) {
    console.error(
      "[kitchen-alias] failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: d.kitchen.api.aliasSaveFailed },
      { status: 500 }
    );
  }
}
