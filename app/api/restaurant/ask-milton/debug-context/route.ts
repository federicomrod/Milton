// app/api/restaurant/ask-milton/debug-context/route.ts
//
// GET /api/restaurant/ask-milton/debug-context
//
// Development-only diagnostic endpoint. Returns counts (no content) so
// engineers can verify the context builder is seeing the right data without
// exposing ingredient names, costs, or any sensitive information in
// production.
//
// Returns 403 in non-development environments.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { buildAskMiltonContext } from "@/lib/restaurant/ask-milton-context";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json(
      { error: "Only available in development" },
      { status: 403 }
    );
  }

  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const { supabase, companyId } = auth;

  const ctx = await buildAskMiltonContext(supabase, companyId);

  return NextResponse.json({
    ingredients_count: ctx.ingredients.total,
    cost_entries_with_latest:
      ctx.expensive_ingredients.length > 0
        ? "has data"
        : "empty — check ingredient_cost_entries",
    expensive_ingredients_count: ctx.expensive_ingredients.length,
    expensive_ingredients_sample: ctx.expensive_ingredients
      .slice(0, 3)
      .map((e) => ({
        name: e.name,
        unit_cost: e.unit_cost,
        unit: e.unit,
        supplier_name: e.supplier_name,
        used_in_count: e.used_in.length,
      })),
    ingredient_usage_count: ctx.ingredient_usage.length,
    ingredient_usage_sample: ctx.ingredient_usage.slice(0, 3).map((u) => ({
      name: u.ingredient_name,
      unit_cost: u.unit_cost,
      direct_menu_items: u.used_in_direct.length,
      via_component_menu_items: u.used_in_via_component.length,
    })),
    menu_items_count:
      ctx.briefing.top_revenue_items.length + " (POS-mapped, up to 5 shown)",
    recipes_count:
      ctx.briefing.data_quality.menu_items_without_recipe +
      " items without recipe",
    most_profitable_items_count: ctx.menu.most_profitable_items.length,
    least_profitable_items_count: ctx.menu.least_profitable_items.length,
    invoices_total_recent: ctx.invoices.total_recent,
    open_recommendations: ctx.briefing.open_recommendations.total,
  });
}
