// app/api/mobile/v1/kitchen/devices/route.ts
//
// GET: the cooks' phones (never a token or hash), ?locationId= to filter.
// Owner only. Read through the caller's RLS client with explicit columns.

import { NextRequest } from "next/server";
import { authAndCompanyFromBearer } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { serializeKitchenDevice } from "@/lib/restaurant/kitchen/kitchen-serializer";
import { UUID_RE, mobileJson } from "@/lib/restaurant/kitchen/mobile-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIST_LIMIT = 200;

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

    let staffQuery = supabase
      .from("kitchen_staff")
      .select("id, display_name")
      .eq("company_id", companyId);
    if (locationId) staffQuery = staffQuery.eq("location_id", locationId);
    const { data: staff, error: staffError } = await staffQuery;
    if (staffError) {
      return mobileJson({ error: "No pude cargar los teléfonos." }, 500);
    }
    const names = new Map(
      (staff ?? []).map((s) => [s.id as string, s.display_name as string])
    );
    if (names.size === 0) return mobileJson({ devices: [] });

    const { data, error } = await supabase
      .from("kitchen_devices")
      .select(
        "id, staff_id, platform, device_label, last_seen_at, revoked_at, created_at"
      )
      .eq("company_id", companyId)
      .in("staff_id", [...names.keys()])
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) {
      return mobileJson({ error: "No pude cargar los teléfonos." }, 500);
    }
    return mobileJson({
      devices: (data ?? []).map((row) =>
        serializeKitchenDevice(
          row as Record<string, unknown>,
          names.get(row.staff_id as string) ?? null
        )
      ),
    });
  } catch (err) {
    console.error(
      "[mobile-devices] list failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return mobileJson({ error: "No pude cargar los teléfonos." }, 500);
  }
}
