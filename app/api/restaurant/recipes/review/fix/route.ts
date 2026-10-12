import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { applyReviewFix } from "@/lib/restaurant/recipe-costing/review-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const odooProductId = Number(body.odoo_product_id);
  const rawName = typeof body.raw_name === "string" ? body.raw_name.trim() : "";
  if (!Number.isInteger(odooProductId) || odooProductId <= 0 || !rawName) {
    return NextResponse.json(
      { error: "Indica el producto y la línea que quieres corregir." },
      { status: 400 }
    );
  }
  try {
    const result = await applyReviewFix({
      supabase: auth.supabase,
      companyId: auth.companyId,
      odooProductId,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
      sourceRow:
        typeof body.source_row === "number"
          ? body.source_row
          : Number(body.source_row) || null,
      rawName,
      unit: typeof body.unit === "string" ? body.unit : undefined,
      quantity:
        typeof body.quantity === "number"
          ? body.quantity
          : Number(body.quantity) || undefined,
      yieldValue:
        typeof body.yield_value === "number"
          ? body.yield_value
          : Number(body.yield_value) || undefined,
      unitCost:
        typeof body.unit_cost === "number"
          ? body.unit_cost
          : Number(body.unit_cost) || undefined,
      addLine: body.add_line === true,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recipes/review/fix]", err);
    return NextResponse.json(
      { error: "No pude guardar la corrección." },
      { status: 500 }
    );
  }
}
