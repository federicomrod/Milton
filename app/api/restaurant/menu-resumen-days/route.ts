// GET /api/restaurant/menu-resumen-days?location_id=
//
// R1-18: the one dataset of Menú › Resumen: sales per day and product (the same
// read as the Cockpit's cost rows: SQL rollup when applied, else the rows) and
// the menu dishes with each variant's cost and status. Read once after the page
// paints; range and the rest are computed in the browser. Company and user come
// from auth; the restaurant is validated against the caller's company.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { fetchDayProducts } from "@/lib/restaurant/cockpit-cost-days";
import { buildResumenData } from "@/lib/restaurant/menu-resumen-data";

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
  const locationId = context.selected?.locationId ?? null;
  const [timezone, currency] = await Promise.all([
    resolvePosTimezone(auth.supabase, auth.companyId),
    resolveCompanyCurrency(auth.supabase, auth.companyId),
  ]);
  const started = Date.now();
  try {
    const [day, economics] = await Promise.all([
      fetchDayProducts(auth.supabase, auth.companyId, {
        locationId,
        timezone,
        currency,
        loadRows: async () =>
          (
            await fetchCompanyPosSalesRows(
              auth.supabase,
              auth.companyId,
              locationId
            )
          ).rows as never,
      }),
      loadDishEconomics(auth.companyId, null, null, locationId),
    ]);
    if (!economics.ok) {
      return NextResponse.json(
        { error: "No pude calcular los platos." },
        { status: 500 }
      );
    }
    const data = buildResumenData({
      currency,
      products: day.products,
      menuDishes: economics.result.menu_dishes,
    });
    console.info(
      `[menu-resumen-days] ${Date.now() - started}ms source=${day.source} dishes=${data.dishes.length} rows=${data.days.length}`
    );
    return NextResponse.json(data);
  } catch (err) {
    console.error("[menu-resumen-days]", err);
    return NextResponse.json(
      { error: "No pude cargar el resumen del menú." },
      { status: 500 }
    );
  }
}
