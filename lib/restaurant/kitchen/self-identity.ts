// lib/restaurant/kitchen/self-identity.ts
//
// A signed-in manager (recipes or kitchen rights) can switch Gestión to Cocina
// without a link. The server finds or creates THAT user's own kitchen_staff row
// (linked by user_id, one per restaurant, no Telegram ids) and issues a device
// token through the authenticated manager session. The manager is never written
// to company_memberships by this, and no session is touched.

import type { SupabaseClient } from "@supabase/supabase-js";
import { issueKitchenDevice } from "./app-identity";

export type SelfDeviceResult =
  | {
      ok: true;
      deviceToken: string;
      staffId: string;
      staffName: string;
      companyId: string;
      locationId: string;
      locationName: string;
    }
  | { ok: false; reason: "location" | "error" };

export async function ensureSelfKitchenDevice(
  admin: SupabaseClient,
  input: {
    companyId: string;
    userId: string;
    displayName: string;
    locationId?: string | null;
    platform?: string | null;
    deviceLabel?: string | null;
  }
): Promise<SelfDeviceResult> {
  try {
    let query = admin
      .from("restaurant_locations")
      .select("id, name, status")
      .eq("company_id", input.companyId);
    if (input.locationId) query = query.eq("id", input.locationId);
    const { data: locations, error } = await query.limit(50);
    if (error) return { ok: false, reason: "error" };
    const location = (locations ?? []).find(
      (l) => l.status == null || l.status === "active"
    );
    if (!location) return { ok: false, reason: "location" };
    const locationId = location.id as string;

    const { data: existing, error: findError } = await admin
      .from("kitchen_staff")
      .select("id, display_name, is_active")
      .eq("company_id", input.companyId)
      .eq("user_id", input.userId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (findError) return { ok: false, reason: "error" };

    let staffId: string;
    let staffName: string;
    if (existing) {
      staffId = existing.id as string;
      staffName = (existing.display_name as string) ?? input.displayName;
      if (existing.is_active !== true) {
        const { error: reactivate } = await admin
          .from("kitchen_staff")
          .update({ is_active: true, removed_at: null, removed_by: null })
          .eq("id", staffId)
          .eq("company_id", input.companyId);
        if (reactivate) return { ok: false, reason: "error" };
      }
    } else {
      staffName = input.displayName.trim().slice(0, 128) || "Cocina";
      const { data: created, error: insertError } = await admin
        .from("kitchen_staff")
        .insert({
          company_id: input.companyId,
          location_id: locationId,
          user_id: input.userId,
          telegram_user_id: null,
          chat_id: null,
          display_name: staffName,
          is_active: true,
        })
        .select("id")
        .single();
      if (insertError || !created) return { ok: false, reason: "error" };
      staffId = created.id as string;
    }

    const issued = await issueKitchenDevice(admin, {
      companyId: input.companyId,
      staffId,
      platform: input.platform,
      deviceLabel: input.deviceLabel,
    });
    if (!issued.ok) return { ok: false, reason: "error" };
    return {
      ok: true,
      deviceToken: issued.deviceToken,
      staffId,
      staffName,
      companyId: input.companyId,
      locationId,
      locationName: (location.name as string) ?? "",
    };
  } catch (err) {
    console.error(
      "[kitchen-self] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return { ok: false, reason: "error" };
  }
}
