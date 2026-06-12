// app/api/restaurant/ingredients/route.ts
//
// GET  /api/restaurant/ingredients  → { ingredients: [...] }
// POST /api/restaurant/ingredients  → create one ingredient
//
// Cost tracking is intentionally OUT of scope for this milestone — we
// still write `current_unit_cost` as a non-negotiable column (the legacy
// schema requires it), but the UI never asks the user for a cost.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("ingredients")
    .select(
      "id, name, category, default_unit, current_unit_cost, currency, created_at, updated_at"
    )
    .eq("company_id", auth.companyId)
    .order("name", { ascending: true });

  if (error) {
    console.error("[ingredients GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ingredients: data ?? [] });
}

interface CreateBody {
  name?: unknown;
  category?: unknown;
  default_unit?: unknown;
  currency?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "`name` is required" }, { status: 400 });
  }
  const category =
    typeof body.category === "string" && body.category.trim() !== ""
      ? body.category.trim()
      : "uncategorized";
  const defaultUnit =
    typeof body.default_unit === "string" && body.default_unit.trim() !== ""
      ? body.default_unit.trim()
      : "kg";
  const currency =
    typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
      ? body.currency
      : "MXN";

  const { data, error } = await auth.supabase
    .from("ingredients")
    .insert({
      company_id: auth.companyId,
      name,
      category,
      default_unit: defaultUnit,
      // Costing lands later — initialize to 0 so the NOT NULL legacy column
      // is satisfied without implying a real price.
      current_unit_cost: 0,
      currency,
    })
    .select("id, name, category, default_unit, current_unit_cost, currency")
    .single();

  if (error || !data) {
    console.error("[ingredients POST]", error?.message);
    return NextResponse.json(
      { error: "Create failed", details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ingredient: data });
}
