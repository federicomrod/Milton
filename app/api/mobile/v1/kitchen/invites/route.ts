// app/api/mobile/v1/kitchen/invites/route.ts
//
// Owner-only (kitchen.qr: the owner, and Milton staff like the web QR).
//   POST: create a personal, single-use, 7-day invite for one location. The
//         secret is returned once inside inviteUrl; only its hash is stored.
//   GET:  list the invites (never a secret or hash), ?locationId= to filter.
// Supabase access token as bearer; the list is read through RLS.

import { NextRequest } from "next/server";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { createKitchenInvite } from "@/lib/restaurant/kitchen/app-identity";
import { serializeKitchenInvite } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { UUID_RE, mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIST_LIMIT = 100;

export async function POST(request: NextRequest) {
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

    let body: { locationId?: unknown; inviteeName?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return mobileJson({ error: "El mensaje no es válido." }, 400);
    }
    const locationId =
      typeof body.locationId === "string" ? body.locationId : "";
    if (!UUID_RE.test(locationId)) {
      return mobileJson({ error: "El restaurante no es válido." }, 400);
    }

    const created = await createKitchenInvite(createAdminClient(), {
      companyId,
      locationId,
      createdBy: userId,
      inviteeName:
        typeof body.inviteeName === "string" ? body.inviteeName : null,
    });
    if (!created.ok) {
      return created.reason === "location"
        ? mobileJson({ error: "No encontré ese restaurante." }, 404)
        : mobileJson({ error: "No pude crear la invitación." }, 500);
    }

    const origin = new URL(request.url).origin;
    return mobileJson(
      {
        inviteId: created.inviteId,
        inviteUrl: `${origin}/k/${created.secret}`,
        expiresAt: created.expiresAt,
      },
      201
    );
  } catch (err) {
    console.error(
      "[mobile-invites] create failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: "No pude crear la invitación." }, 500);
  }
}

export async function GET(request: NextRequest) {
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

    const locationId = new URL(request.url).searchParams.get("locationId");
    if (locationId && !UUID_RE.test(locationId)) {
      return mobileJson({ error: "El restaurante no es válido." }, 400);
    }

    let query = supabase
      .from("kitchen_invites")
      .select(
        "id, location_id, invitee_name, expires_at, used_at, revoked_at, created_at"
      )
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (locationId) query = query.eq("location_id", locationId);
    const { data, error } = await query;
    if (error) {
      return mobileJson({ error: "No pude cargar las invitaciones." }, 500);
    }
    const now = new Date();
    return mobileJson({
      invites: (data ?? []).map((row) =>
        serializeKitchenInvite(row as Record<string, unknown>, now)
      ),
    });
  } catch (err) {
    console.error(
      "[mobile-invites] list failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: "No pude cargar las invitaciones." }, 500);
  }
}
