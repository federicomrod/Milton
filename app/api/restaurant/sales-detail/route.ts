// GET /api/restaurant/sales-detail?location_id=
//
// R1-17b: the one dataset of Ventas › Detalle (the cube), the goals and the
// restaurants. Read once; every filter, comparison and click is then computed
// in the browser. Company and user come from auth; the restaurant is validated
// against the caller's company.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { loadSalesDetail } from "@/lib/restaurant/sales-detail-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    req.nextUrl.searchParams.get("location_id")
  );
  const started = Date.now();
  try {
    const payload = await loadSalesDetail(
      auth.supabase,
      auth.companyId,
      context.selected?.locationId ?? null
    );
    console.info(
      `[sales-detail] ${Date.now() - started}ms rows=${payload.cube.rows.length} orders=${payload.cube.order_count}`
    );
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[sales-detail]", err);
    return NextResponse.json(
      { error: "No pude cargar las ventas." },
      { status: 500 }
    );
  }
}
