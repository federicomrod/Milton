// app/api/mobile/v1/kitchen/team/[id]/route.ts
//
// POST (manager's Supabase session): one action on one cook of THIS company.
//   { action: "reset_pin", mode: "temporary" | "clear" }
//   { action: "new_link" }
//   { action: "sign_out", deviceId? }   (one phone, or all of the cook's phones)
// Owner, admin and manager only (kitchen.team). The company comes from the
// session; a cook of another company is a 404.

import { NextRequest } from "next/server";
import { getDictionary } from "@/lib/i18n";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  UUID_RE,
  mobileJson,
  mobileLanguage,
} from "@/lib/restaurant/kitchen/mobile-response";
import {
  newLinkForStaff,
  resetKitchenPin,
  signOutKitchenPhones,
} from "@/lib/restaurant/kitchen/team-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const d = getDictionary(mobileLanguage(request));
  const auth = await authAndCompanyFromBearer(request);
  if (!auth.ok) return auth.response;
  const { supabase, companyId, userId } = auth;
  try {
    const actor = await resolveActor(supabase, userId, { companyId });
    const denied = requireCapability(actor, "kitchen.team");
    if (denied) {
      denied.headers.set("Cache-Control", "no-store");
      return denied;
    }
    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return mobileJson({ error: d.kitchen.api.idInvalid }, 400);
    }
    let body: Record<string, unknown> = {};
    try {
      const parsed = await request.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return mobileJson({ error: d.kitchen.api.messageInvalid }, 400);
    }
    const admin = createAdminClient();

    if (body.action === "reset_pin") {
      const r = await resetKitchenPin(admin, {
        companyId,
        staffId: id,
        actorUserId: userId,
        mode: body.mode === "clear" ? "clear" : "temporary",
      });
      if (!r.ok) {
        return r.reason === "not_found"
          ? mobileJson({ error: d.kitchen.api.cookNotFound }, 404)
          : mobileJson({ error: d.kitchen.api.teamActionFailed }, 500);
      }
      return mobileJson({ temporaryPin: r.temporaryPin });
    }
    if (body.action === "new_link") {
      const r = await newLinkForStaff(admin, {
        companyId,
        staffId: id,
        actorUserId: userId,
      });
      if (!r.ok) {
        return r.reason === "not_found"
          ? mobileJson({ error: d.kitchen.api.cookNotFound }, 404)
          : mobileJson({ error: d.kitchen.api.teamActionFailed }, 500);
      }
      const origin = new URL(request.url).origin;
      return mobileJson(
        {
          inviteId: r.inviteId,
          inviteUrl: `${origin}/k/${r.secret}`,
          expiresAt: r.expiresAt,
        },
        201
      );
    }
    if (body.action === "sign_out") {
      const deviceId =
        typeof body.deviceId === "string" && UUID_RE.test(body.deviceId)
          ? body.deviceId
          : null;
      if (body.deviceId !== undefined && !deviceId) {
        return mobileJson({ error: d.kitchen.api.idInvalid }, 400);
      }
      const r = await signOutKitchenPhones(admin, {
        companyId,
        staffId: id,
        deviceId,
      });
      if (!r.ok) return mobileJson({ error: d.kitchen.api.cookNotFound }, 404);
      return mobileJson({ success: true });
    }
    return mobileJson({ error: d.kitchen.api.typeInvalid }, 400);
  } catch (err) {
    console.error(
      "[mobile-kitchen-team] action failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: d.kitchen.api.teamActionFailed }, 500);
  }
}
