import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { undoConfirmedPosLink } from "@/lib/restaurant/recipe-costing/link-actions-server";

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
  if (!Number.isInteger(odooProductId) || odooProductId <= 0) {
    return NextResponse.json(
      { error: "Falta odoo_product_id." },
      { status: 400 }
    );
  }
  try {
    const result = await undoConfirmedPosLink({
      supabase: auth.supabase,
      companyId: auth.companyId,
      odooProductId,
      locationId:
        typeof body.location_id === "string" ? body.location_id : null,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ link: result.link });
  } catch (err) {
    console.error("[pos/links/undo]", err);
    return NextResponse.json(
      { error: "No pude deshacer la confirmación." },
      { status: 500 }
    );
  }
}
