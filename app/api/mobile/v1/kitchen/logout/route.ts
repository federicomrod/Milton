// app/api/mobile/v1/kitchen/logout/route.ts
//
// POST: revokes the calling device. Its next request gets 401.

import { NextRequest } from "next/server";
import { authKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-auth";
import { revokeKitchenDevice } from "@/lib/restaurant/kitchen/app-identity";
import { kitchenJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await authKitchenDevice(request);
  if (!auth.ok) return auth.response;
  const result = await revokeKitchenDevice(
    auth.admin,
    auth.deviceId,
    auth.companyId
  );
  if (!result.ok) {
    return kitchenJson({ error: "No pude cerrar la sesión." }, 500);
  }
  return kitchenJson({ success: true });
}
