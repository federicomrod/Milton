// app/api/restaurant/pos/products/route.ts
//
// GET /api/restaurant/pos/products
//
// Lists Odoo products ranked by share of net sales, each with its link
// state. Coverage is computed on the server: only Confirmado + Aprobada
// counts. No KPI logic in React.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { DATE_RE } from "@/lib/restaurant/odoo/sync-window";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const startParam = url.searchParams.get("start_date");
  const endParam = url.searchParams.get("end_date");
  const locationParam = url.searchParams.get("location_id");

  if ((startParam && !endParam) || (!startParam && endParam)) {
    return NextResponse.json(
      {
        error: "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
      },
      { status: 400 }
    );
  }
  if (startParam && endParam) {
    if (!DATE_RE.test(startParam) || !DATE_RE.test(endParam)) {
      return NextResponse.json(
        {
          error:
            "start_date y end_date deben ir juntas, con formato YYYY-MM-DD.",
        },
        { status: 400 }
      );
    }
    if (startParam > endParam) {
      return NextResponse.json(
        { error: "start_date debe ser anterior o igual a end_date." },
        { status: 400 }
      );
    }
  }

  const loaded = await loadPosProductList(auth.supabase, {
    companyId: auth.companyId,
    startDate: startParam,
    endDate: endParam,
    locationId: locationParam,
  });
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: 500 });
  }

  return NextResponse.json(loaded.list);
}
