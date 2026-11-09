// app/api/mobile/v1/locations/route.ts
//
// GET: the restaurants of the caller's company (id + name), for the manager
// app's restaurant picker. Same role gate as the other Gestión routes.

import { NextRequest } from "next/server";
import { authManager } from "@/lib/restaurant/mobile-manager/auth";
import { mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await authManager(request);
  if (!auth.ok) return auth.response;
  return mobileJson({
    locations: auth.locations.map((l) => ({ id: l.id, name: l.name })),
  });
}
