// app/api/restaurant/ingredient-costs/route.ts
//
// GET  /api/restaurant/ingredient-costs?ingredient_id=...
//   → { entries: IngredientCostEntry[] }
//
// POST /api/restaurant/ingredient-costs
//   Body: {
//     ingredient_id, cost_date, quantity, unit, total_cost,
//     currency?, supplier_id?, notes?
//   }
//   Server-side:
//     * computes unit_cost = total_cost / quantity
//     * computes normalized_unit and normalized_unit_cost using the
//       ingredient's default_unit (the cockpit's canonical unit).
//     * inserts with source_type='manual'.
//
// We compute normalization on the server so the canonical projection is
// authoritative regardless of which client wrote it (today the dashboard;
// tomorrow the invoice importer).

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const ingredientId = url.searchParams.get("ingredient_id");

  let q = auth.supabase
    .from("ingredient_cost_entries")
    .select(
      "id, ingredient_id, supplier_id, source_type, source_id, cost_date, quantity, unit, total_cost, unit_cost, normalized_unit, normalized_unit_cost, currency, notes, created_at"
    )
    .eq("company_id", auth.companyId)
    .order("cost_date", { ascending: false });
  if (ingredientId) q = q.eq("ingredient_id", ingredientId);

  const { data, error } = await q;
  if (error) {
    console.error("[ingredient-costs GET]", error.message);
    return NextResponse.json(
      { error: "Read failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ entries: data ?? [] });
}

interface PostBody {
  ingredient_id?: unknown;
  cost_date?: unknown;
  quantity?: unknown;
  unit?: unknown;
  total_cost?: unknown;
  currency?: unknown;
  supplier_id?: unknown;
  notes?: unknown;
}

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // ---- Validate ---------------------------------------------------------
  const ingredientId =
    typeof body.ingredient_id === "string" ? body.ingredient_id : "";
  if (!ingredientId) {
    return NextResponse.json(
      { error: "ingredient_id is required" },
      { status: 400 }
    );
  }
  const costDate =
    typeof body.cost_date === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(body.cost_date)
      ? body.cost_date.slice(0, 10)
      : "";
  if (!costDate) {
    return NextResponse.json(
      { error: "cost_date must be ISO yyyy-mm-dd" },
      { status: 400 }
    );
  }
  const quantity =
    typeof body.quantity === "number" ? body.quantity : Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return NextResponse.json(
      { error: "quantity must be a positive number" },
      { status: 400 }
    );
  }
  const totalCost =
    typeof body.total_cost === "number"
      ? body.total_cost
      : Number(body.total_cost);
  if (!Number.isFinite(totalCost) || totalCost < 0) {
    return NextResponse.json(
      { error: "total_cost must be a non-negative number" },
      { status: 400 }
    );
  }
  const unit = typeof body.unit === "string" ? body.unit.trim() : "";
  if (!unit) {
    return NextResponse.json({ error: "unit is required" }, { status: 400 });
  }
  const currency =
    typeof body.currency === "string" && /^[A-Z]{3}$/.test(body.currency)
      ? body.currency
      : "MXN";
  const supplierId =
    typeof body.supplier_id === "string" && body.supplier_id.trim() !== ""
      ? body.supplier_id
      : null;
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null;

  // ---- Resolve ingredient (for default_unit) ---------------------------
  // We project the cost into the ingredient's canonical unit so the
  // costing engine doesn't have to do that work per query.
  const { data: ingredient, error: ingErr } = await auth.supabase
    .from("ingredients")
    .select("id, default_unit")
    .eq("company_id", auth.companyId)
    .eq("id", ingredientId)
    .maybeSingle();
  if (ingErr) {
    console.error("[ingredient-costs POST ing lookup]", ingErr.message);
    return NextResponse.json(
      { error: "Could not load ingredient", details: ingErr.message },
      { status: 500 }
    );
  }
  if (!ingredient) {
    return NextResponse.json(
      { error: "Ingredient not found for this company" },
      { status: 404 }
    );
  }

  // ---- Compute derived numbers ----------------------------------------
  const unitCost = totalCost / quantity;
  // Normalize to the ingredient's default unit when both sides are
  // bridge-able. Otherwise we store the unit as-typed and the engine
  // will surface a `missing_unit_conversion` if/when a recipe tries to
  // consume this ingredient in an incompatible unit.
  const targetUnit = ingredient.default_unit || unit;
  const normalized = convertUnitPriceStr(unitCost, unit, targetUnit);
  const normalizedUnit = normalizeUnit(targetUnit) ?? targetUnit;
  const normalizedUnitCost = normalized.ok ? normalized.value : unitCost;
  // Note: when conversion fails we still record SOMETHING (the supplier
  // unit cost) so the entry is queryable; downstream costing.ts will
  // detect the unit mismatch and surface a `missing_unit_conversion`
  // issue rather than silently using the wrong number.

  const { data, error } = await auth.supabase
    .from("ingredient_cost_entries")
    .insert({
      company_id: auth.companyId,
      ingredient_id: ingredientId,
      supplier_id: supplierId,
      source_type: "manual",
      source_id: null,
      cost_date: costDate,
      quantity,
      unit,
      total_cost: totalCost,
      unit_cost: unitCost,
      normalized_unit: normalizedUnit,
      normalized_unit_cost: normalizedUnitCost,
      currency,
      notes,
    })
    .select("*")
    .single();

  if (error || !data) {
    console.error("[ingredient-costs POST]", error?.message);
    return NextResponse.json(
      {
        error: "Insert failed",
        details: error?.message,
        pg: {
          message: error?.message ?? null,
          code: (error as { code?: string } | null)?.code ?? null,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    entry: data,
    normalization_ok: normalized.ok,
    target_unit: targetUnit,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json(
      { error: "id query param required" },
      { status: 400 }
    );
  }
  const { error } = await auth.supabase
    .from("ingredient_cost_entries")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: "Delete failed", details: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
