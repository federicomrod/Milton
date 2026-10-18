// GET /api/restaurant/ingredients/duplicates/report
//
// READ-ONLY report of probable duplicate ingredients by spelling (same logic as
// the «Posibles duplicados» banner). Nothing is written. Merge a group with
// «Unir…» in Menú › Ingredientes. Add ?format=text for a plain list.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { fetchIngredientLatestCosts } from "@/lib/restaurant/menu-recipes-server";
import { loadIngredientUsage } from "@/lib/restaurant/ingredient-usage-server";
import { loadDuplicateState } from "@/lib/restaurant/ingredient-duplicates-server";
import { duplicateReport } from "@/lib/restaurant/ingredient-duplicate-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const [ingredients, usage, state] = await Promise.all([
    fetchIngredientLatestCosts(auth.supabase, auth.companyId),
    loadIngredientUsage(auth.supabase, auth.companyId),
    loadDuplicateState(auth.supabase, auth.companyId),
  ]);
  const groups = duplicateReport(
    ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.default_unit,
      archived: usage.archivedIds.has(i.id),
      price: i.latest ? i.latest.normalized_unit_cost : null,
      priceUnit: i.latest?.normalized_unit ?? null,
      recipeCount: usage.dishCount.get(i.id) ?? 0,
    })),
    new Set(state.notDuplicates)
  );
  if (new URL(req.url).searchParams.get("format") === "text") {
    const text = groups
      .map((g) =>
        g.members
          .map(
            (m) =>
              `${m.suggested_survivor ? "★" : "·"} ${m.name} — ${
                m.price !== null
                  ? `${m.price}/${m.priceUnit ?? m.unit ?? ""}`
                  : "Sin precio"
              } — ${m.recipeCount} recetas`
          )
          .join("\n")
      )
      .join("\n\n");
    return new NextResponse(text || "Sin posibles duplicados.", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({ groups });
}
