// GET /api/restaurant/cockpit-cost-days?location_id=
//
// R1-16b: the day × category rows (net sales, cost of the costed products, the
// sales that cost covers) the Cockpit needs for food cost %, margin and the
// sales mix. Read once after the Cockpit paints (the sales cards never wait for
// it) and filtered in the browser from then on. Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import {
  buildMixRows,
  fetchDayProducts,
  resolverFromDishEconomics,
} from "@/lib/restaurant/cockpit-cost-days";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const requested = req.nextUrl.searchParams.get("location_id");
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    requested
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
    // Without dish costing nothing is costed: every sale is uncosted (never $0).
    const resolver = economics.ok
      ? resolverFromDishEconomics(economics.result)
      : { unitCostOf: () => null, categoryOf: () => null };
    const rows = buildMixRows(day.products, resolver);
    console.info(
      `[cockpit-cost-days] ${Date.now() - started}ms source=${day.source} products=${day.products.length} rows=${rows.length}`
    );
    return NextResponse.json({
      rows,
      source: day.source,
      costed: economics.ok,
    });
  } catch (err) {
    console.error("[cockpit-cost-days]", err);
    return NextResponse.json(
      { error: "No pude calcular el costo por día." },
      { status: 500 }
    );
  }
}
