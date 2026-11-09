// app/api/mobile/v1/home/route.ts
//
// GET ?location=: Inicio of the manager app. Role-gated on the server
// (owner, admin, manager); a kitchen device token never gets here.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { buildHome } from "@/lib/restaurant/mobile-manager/home";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";
import { getDictionary } from "@/lib/i18n";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  try {
    const home = await buildHome({
      supabase: auth.supabase,
      companyId: auth.companyId,
      locationId: auth.locationId,
      singleLocationId: auth.singleLocationId,
      restaurantIds: auth.locations.map((l) => l.id),
      lang: auth.lang,
    });
    return mobileJson({
      ...home,
      locations: auth.locations.map((l) => ({ id: l.id, name: l.name })),
    });
  } catch (err) {
    console.error(
      "[mobile-home] failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson(
      { error: getDictionary(auth.lang).kitchen.api.managerLoadFailed },
      500
    );
  }
}
