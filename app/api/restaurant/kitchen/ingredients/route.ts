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
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { findSimilarIngredient } from "@/lib/restaurant/ingredient-similar";
import {
  aliasKeyFor,
  createSupabaseCostWorkbookRepo,
} from "@/lib/restaurant/cost-workbook/repo";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";
import { kitchenManagerGuard } from "@/lib/restaurant/telegram/kitchen-manager-guard";
import { normalizeUnit } from "@/lib/restaurant/units";

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
  const name =
    typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > MAX_NAME) {
    return NextResponse.json(
      { error: "Escribe el nombre del ingrediente." },
      { status: 400 }
    );
  }
  const unit =
    typeof body?.unit === "string" && normalizeUnit(body.unit)
      ? body.unit.trim()
      : "unit";

  try {
    const [ingredients, aliases] = await Promise.all([
      fetchAllRows<{ id: string; name: string }>(() =>
        auth.supabase
          .from("ingredients")
          .select("id, name")
          .eq("company_id", auth.companyId)
      ),
      createSupabaseCostWorkbookRepo(auth.supabase)
        .listIngredientAliases(auth.companyId)
        .catch(() => []),
    ]);
    const similar = findSimilarIngredient(
      name,
      ingredients.error ? [] : ingredients.rows,
      new Map(aliases.map((row) => [row.alias_key, row.ingredient_id])),
      aliasKeyFor
    );
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
