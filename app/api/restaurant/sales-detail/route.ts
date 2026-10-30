// GET /api/restaurant/sales-detail?location_id=
//
// R1-17b: the one dataset of Ventas › Detalle (the cube), the goals and the
// restaurants. Read once; every filter, comparison and click is then computed
// in the browser. Company and user come from auth; the restaurant is validated
// against the caller's company.

import { accessTokenOf, cacheClientFor } from "@/lib/restaurant/cache-client";
import { cachedForCompany, salesTag } from "@/lib/restaurant/cache-tags";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { apiDictionary } from "@/lib/restaurant/api-lang";
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
    const locationId = context.selected?.locationId ?? null;
    // The cube (every sales row) is the heavy read: keep it across requests
    // (5 min, expired by a POS sync / upload, a shift, a goal or a restaurant
    // change). The cached read runs RLS-bound with the caller's token.
    const token = await accessTokenOf(auth.supabase);
    const payload = token
      ? await cachedForCompany(
          {
            name: "sales-detail",
            companyId: auth.companyId,
            parts: { location: locationId },
            tags: [salesTag(auth.companyId)],
          },
          async () =>
            loadSalesDetail(
              await cacheClientFor(token),
              auth.companyId,
              locationId,
              { failOnReadError: true }
            ),
          () => loadSalesDetail(auth.supabase, auth.companyId, locationId)
        )
      : await loadSalesDetail(auth.supabase, auth.companyId, locationId);
    console.info(
      `[sales-detail] ${Date.now() - started}ms rows=${payload.cube.rows.length} orders=${payload.cube.order_count}`
    );
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[sales-detail]", err);
    return NextResponse.json(
      { error: (await apiDictionary()).sales.api.salesLoadFailed },
      { status: 500 }
    );
  }
}
