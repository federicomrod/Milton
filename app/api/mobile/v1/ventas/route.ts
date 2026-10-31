// app/api/mobile/v1/ventas/route.ts
//
// GET ?period=day|week|month|year&location=: Ventas of the manager app, from
// the same cube and functions as Ventas › Detalle on the web.

import { NextRequest } from "next/server";
import {
  authManager,
  managerError,
} from "@/lib/restaurant/mobile-manager/auth";
import {
  buildVentas,
  parseVentasPeriod,
} from "@/lib/restaurant/mobile-manager/sales";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const period = parseVentasPeriod(
    new URL(request.url).searchParams.get("period")
  );
  if (!period) return managerError(request, "managerPeriodInvalid", 400);
  try {
    return mobileJson(
      await buildVentas({
        supabase: auth.supabase,
        companyId: auth.companyId,
        locationId: auth.locationId,
        period,
        lang: auth.lang,
      })
    );
  } catch (err) {
    console.error(
      "[mobile-ventas] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return managerError(request, "managerLoadFailed", 500);
  }
}
