// app/api/mobile/v1/kitchen/devices/[id]/route.ts
//
// DELETE: revoke a cook's phone now. Its next request gets 401. Owner only.

import { NextRequest } from "next/server";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { revokeKitchenDevice } from "@/lib/restaurant/kitchen/app-identity";
import { UUID_RE, mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authAndCompanyFromBearer(request);
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;
  try {
    const actor = await resolveActor(supabase, userId, { companyId });
    const denied = requireCapability(actor, "kitchen.qr");
    if (denied) {
      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return mobileJson({ error: "El identificador no es válido." }, 400);
    }
    const result = await revokeKitchenDevice(
      createAdminClient(),
      id,
      companyId
    );
    if (!result.ok) {
      return mobileJson({ error: "No pude quitar el teléfono." }, 500);
    }
    if (!result.revoked) {
      return mobileJson({ error: "No encontré el teléfono." }, 404);
    }
    return mobileJson({ success: true });
  } catch (err) {
    console.error(
      "[mobile-devices] revoke failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: "No pude quitar el teléfono." }, 500);
  }
}
