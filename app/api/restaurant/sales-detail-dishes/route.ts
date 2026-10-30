// GET /api/restaurant/sales-detail-dishes?from=&to=&location_id=
//
// R1-17b: the Platos tab of Ventas › Detalle. The same dish economics as Menú
// (variants, sales, costs) for the page's period and restaurant; the drill-down
// itself is the existing Plato del menú view.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";
import { loadDishEconomics } from "@/lib/restaurant/costing/dish-economics-server";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const q = req.nextUrl.searchParams;
  const from = q.get("from");
  const to = q.get("to");
  if (!from || !to || !DATE.test(from) || !DATE.test(to)) {
    return NextResponse.json(
      { error: (await apiDictionary()).sales.api.missingDates },
      { status: 400 }
    );
  }
  const context = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    q.get("location_id")
  );
  const [load, currency] = await Promise.all([
    loadDishEconomics(
      auth.companyId,
      from,
      to,
      context.selected?.locationId ?? null
    ),
    resolveCompanyCurrency(auth.supabase, auth.companyId),
  ]);
  if (!load.ok) {
    return NextResponse.json(
      { error: (await apiDictionary()).sales.api.dishesLoadFailed },
      { status: 500 }
    );
  }
  const r = load.result;
  return NextResponse.json({
    currency,
    menu_dishes: r.menu_dishes,
    menu_sales: r.menu_totals?.food_net_sales ?? 0,
  });
}
