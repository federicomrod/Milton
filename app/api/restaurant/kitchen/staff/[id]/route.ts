// app/api/restaurant/kitchen/staff/[id]/route.ts
//
// DELETE: remove a cook (R1 #55). Owners and Milton admins only
// (canManageKitchenQr), company-checked. Sets is_active = false,
// removed_at and removed_by; the row (and the cook's past reports) stay.
// A removed cook is ignored by the bot until they rescan a valid QR. Their app
// devices (mobile P0b) are revoked too, so the next app request gets 401.

import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { revokeKitchenDevicesForStaff } from "@/lib/restaurant/kitchen/app-identity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const d = await apiDictionary();
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;

    const actor = await resolveActor(auth.supabase, userId, { companyId });
    const denied = requireCapability(actor, "kitchen.qr");
    if (denied) return denied;

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: d.kitchen.api.idInvalid },
        { status: 400 }
      );
    }
    const now = new Date().toISOString();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("kitchen_staff")
      .update({
        is_active: false,
        removed_at: now,
        removed_by: userId,
        updated_at: now,
      })
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[kitchen-staff] remove failed:", error.message);
      return NextResponse.json(
        { error: d.kitchen.api.cookRemoveFailed },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: d.kitchen.api.cookNotFound },
        { status: 404 }
      );
    }
    // Never throws and never blocks the removal: before migration 068 is
    // applied there is no devices table and this is a no-op.
    await revokeKitchenDevicesForStaff(admin, id, companyId);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[kitchen-staff] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: d.kitchen.api.cookRemoveFailed },
      { status: 500 }
    );
  }
}
