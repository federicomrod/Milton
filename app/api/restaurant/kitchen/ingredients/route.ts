// app/api/restaurant/kitchen/ingredients/route.ts
//
//   GET  → the company's ACTIVE ingredients (archived ones are hidden, like the
//          main ingredients list) with their current price per unit, for the
//          Revisar receta screen. The price is the shared `latestCostEntry`.
//   POST → create an ingredient WITHOUT a price ({ name, unit? }). It uses the
//          same duplicate rule as the recipe editor: a case/accent variant or a
//          remembered alias answers 409 «Ya existe "X". ¿Usarlo?» and creates
//          nothing. Owner / Milton staff only. Company from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { fetchIngredientLatestCosts } from "@/lib/restaurant/menu-recipes-server";
import {
  isActiveIngredient,
  loadCompanyIngredients,
} from "@/lib/restaurant/ingredient-active";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { findSimilarIngredient } from "@/lib/restaurant/ingredient-similar";
import {
  aliasKeyFor,
  createSupabaseCostWorkbookRepo,
} from "@/lib/restaurant/cost-workbook/repo";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import { sentenceCase } from "@/lib/restaurant/sentence-case";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";
import { normalizeUnit } from "@/lib/restaurant/units";
import { mapKitchenUnit } from "@/lib/restaurant/kitchen-units";

export const dynamic = "force-dynamic";

const MAX_NAME = 120;

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  try {
    const rows = await fetchIngredientLatestCosts(
      auth.supabase,
      auth.companyId
    );
    // Archived (merged or hidden) ingredients are never offered. Before the
    // archive column exists nothing is hidden.
    const archived = new Set<string>();
    const archivedRes = await auth.supabase
      .from("ingredients")
      .select("id")
      .eq("company_id", auth.companyId)
      .not("archived_at", "is", null);
    if (!archivedRes.error) {
      for (const row of archivedRes.data ?? []) archived.add(String(row.id));
    }
    return NextResponse.json({
      ingredients: rows
        .filter((row) => !archived.has(row.id))
        .map((row) => ({
          id: row.id,
          name: row.name,
          default_unit: row.default_unit,
          price: row.latest
            ? {
                unit_cost: Number(row.latest.normalized_unit_cost),
                unit: row.latest.normalized_unit,
              }
            : null,
        })),
    });
  } catch (err) {
    console.error(
      "[kitchen-ingredients] list failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude cargar tus ingredientes." },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const denied = await kitchenManagerGuard(auth.companyId, auth.userId);
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as {
    name?: unknown;
    unit?: unknown;
  } | null;
  // A new ingredient is saved in sentence case («Bacon»); existing ones are
  // never renamed.
  const name = typeof body?.name === "string" ? sentenceCase(body.name) : "";
  if (!name || name.length > MAX_NAME) {
    return NextResponse.json(
      { error: "Escribe el nombre del ingrediente." },
      { status: 400 }
    );
  }
  const unit =
    typeof body?.unit === "string" && normalizeUnit(body.unit)
      ? (mapKitchenUnit(body.unit) ?? body.unit.trim())
      : "unit";

  try {
    const [everyone, aliases] = await Promise.all([
      loadCompanyIngredients(auth.supabase, auth.companyId),
      createSupabaseCostWorkbookRepo(auth.supabase)
        .listIngredientAliases(auth.companyId)
        .catch(() => []),
    ]);
    // Only ACTIVE ingredients can be "the same": a name that belonged to a
    // merged-away ingredient resolves to the survivor through its alias.
    const active = everyone.filter(isActiveIngredient);
    const similar = findSimilarIngredient(
      name,
      active,
      new Map(aliases.map((row) => [row.alias_key, row.ingredient_id])),
      aliasKeyFor
    );
    if (!similar) {
      // The typed name is an ARCHIVED ingredient: merged → use its survivor;
      // otherwise nothing is created and the person is told how to get it back.
      const archivedHit = findSimilarIngredient(
        name,
        everyone.filter((row) => !isActiveIngredient(row))
      );
      if (archivedHit) {
        const merged = await createSupabaseEditorStore(auth.supabase)
          .mergedInto(auth.companyId, archivedHit.id)
          .catch(() => null);
        const survivor = merged?.name
          ? findSimilarIngredient(merged.name, active)
          : null;
        if (survivor) {
          return NextResponse.json(
            {
              error: `Ya existe "${survivor.name}". ¿Usarlo?`,
              existing: { id: survivor.id, name: survivor.name },
            },
            { status: 409 }
          );
        }
        return NextResponse.json(
          {
            error: `"${archivedHit.name}" está archivado. Restáuralo en Ingredientes o usa otro nombre.`,
          },
          { status: 409 }
        );
      }
    }
    if (similar) {
      return NextResponse.json(
        {
          error: `Ya existe "${similar.name}". ¿Usarlo?`,
          existing: { id: similar.id, name: similar.name },
        },
        { status: 409 }
      );
    }
    const currency = await resolveCompanyCurrency(
      auth.supabase,
      auth.companyId
    );
    const created = await createSupabaseEditorStore(
      auth.supabase
    ).createIngredient(auth.companyId, {
      name,
      defaultUnit: unit,
      currency: currency || "USD",
    });
    return NextResponse.json({ ingredient: created });
  } catch (err) {
    console.error(
      "[kitchen-ingredients] create failed:",
      err instanceof Error ? err.message : "Unknown error"
    );
    return NextResponse.json(
      { error: "No pude crear el ingrediente." },
      { status: 500 }
    );
  }
}
