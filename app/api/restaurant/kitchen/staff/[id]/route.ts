// app/api/restaurant/kitchen/staff/[id]/route.ts
//
// DELETE: remove a cook (R1 #55). Owners and Milton admins only
// (canManageKitchenQr), company-checked. Sets is_active = false,
// removed_at and removed_by; the row (and the cook's past reports) stay.
// A removed cook is ignored by the bot until they rescan a valid QR.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { companyId, userId } = auth;

    const [isMiltonAdmin, membershipRole] = await Promise.all([
      isUserAdminServer(userId),
      loadMembershipRole(companyId, userId),
    ]);
    if (!canManageKitchenQr({ isMiltonAdmin, membershipRole })) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }
    const now = new Date().toISOString();
    const { data, error } = await createAdminClient()
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
        { error: "Could not remove the cook" },
        { status: 500 }
      );
    }
    if (!data) {
      return NextResponse.json({ error: "Cook not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(
      "[kitchen-staff] unexpected:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      { error: "Could not remove the cook" },
      { status: 500 }
    );
  }
}
