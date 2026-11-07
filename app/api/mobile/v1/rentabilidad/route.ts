// app/api/mobile/v1/rentabilidad/route.ts
//
// GET ?month=YYYY-MM&location=: Rentabilidad of the manager app, computed by
// the web's loadRentabilidadPage for ONE restaurant and ONE month.

import { NextRequest } from "next/server";
import {
  authManager,
  managerError,
} from "@/lib/restaurant/mobile-manager/auth";
import {
  buildRentabilidad,
  parseMonth,
} from "@/lib/restaurant/mobile-manager/rentabilidad";
import { monthStartOf } from "@/lib/restaurant/fixed-costs";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  const requested = parseMonth(new URL(request.url).searchParams.get("month"));
  if (requested === "invalid") {
    return managerError(request, "managerMonthInvalid", 400);
  }
  if (!auth.singleLocationId) {
    return managerError(request, "managerPickRestaurant", 400);
  }
  const current = monthStartOf(new Date()) as string;
  const month = requested && requested <= current ? requested : current;
  try {
    return mobileJson(
      await buildRentabilidad({
        supabase: auth.supabase,
        companyId: auth.companyId,
        locationId: auth.singleLocationId,
        restaurantIds: auth.locations.map((l) => l.id),
        month,
        lang: auth.lang,
      })
    );
  } catch (err) {
    console.error(
      "[mobile-rentabilidad] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return managerError(request, "managerLoadFailed", 500);
  }
}
