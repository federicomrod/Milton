// app/api/mobile/v1/kitchen/self-device/route.ts
//
// POST (manager's Supabase session as bearer): a signed-in manager with recipe
// or kitchen rights switches Gestión -> Cocina without a link. The server finds
// or creates THIS user's own kitchen_staff row (linked by user_id) and issues a
// device token. Neither session is touched. The answer has the same shape as a
// redeem (token once, no money).

import { NextRequest } from "next/server";
import { getDictionary } from "@/lib/i18n";
import { can, resolveActor } from "@/lib/auth/permissions";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  UUID_RE,
  kitchenJson,
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import { serializeKitchenRedeem } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { ensureSelfKitchenDevice } from "@/lib/restaurant/kitchen/self-identity";
import {
  ensureKitchenCode,
  getKitchenPinStatus,
} from "@/lib/restaurant/kitchen/pin-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authAndCompanyFromBearer(request);
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId, email } = auth;
  try {
    const actor = await resolveActor(supabase, userId, { companyId });
    if (
      !can(actor, "recipes.edit") &&
      !can(actor, "kitchen.drafts") &&
      !can(actor, "kitchen.team")
    ) {
      return mobileJson({ error: d.kitchen.api.selfDeviceForbidden }, 403);
    }
    let body: Record<string, unknown> = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      body = {};
    }
    const locationId =
      typeof body.locationId === "string" && UUID_RE.test(body.locationId)
        ? body.locationId
        : null;

    const admin = createAdminClient();
    const meta = (
      await supabase.auth.getUser(
        request.headers.get("authorization")?.slice(7) ?? ""
      )
    ).data.user?.user_metadata as Record<string, unknown> | undefined;
    const fullName =
      typeof meta?.full_name === "string"
        ? meta.full_name
        : typeof meta?.name === "string"
          ? meta.name
          : "";
    const displayName =
      fullName.trim() || (email ?? "").split("@")[0] || "Cocina";

    const result = await ensureSelfKitchenDevice(admin, {
      companyId,
      userId,
      displayName,
      locationId,
      platform: typeof body.platform === "string" ? body.platform : null,
      deviceLabel:
        typeof body.deviceLabel === "string" ? body.deviceLabel : null,
    });
    if (!result.ok) {
      return result.reason === "location"
        ? mobileJson({ error: d.kitchen.api.restaurantNotFound }, 404)
        : mobileJson({ error: d.kitchen.api.selfDeviceFailed }, 500);
    }
    const company = await admin
      .from("companies")
      .select("preferred_language")
      .eq("id", companyId)
      .maybeSingle();
    const [pin, kitchenCode] = await Promise.all([
      getKitchenPinStatus(admin, companyId, result.staffId),
      ensureKitchenCode(admin, companyId),
    ]);
    return kitchenJson(
      serializeKitchenRedeem({
        pin,
        kitchenCode,
        language: (company.data as { preferred_language?: unknown } | null)
          ?.preferred_language,
        deviceToken: result.deviceToken,
        staffId: result.staffId,
        staffName: result.staffName,
        locationId: result.locationId,
        locationName: result.locationName,
      }),
      201
    );
  } catch (err) {
    console.error(
      "[mobile-self-device] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.selfDeviceFailed }, 500);
  }
}
