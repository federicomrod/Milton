// app/api/restaurant/kitchen/recipe-drafts/[id]/reject/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/reject
//
// Rejects a recipe draft (marks status 'rejected'). Only Milton admins
// and owners can reject (enforced server-side). Uses admin client after
// role check. Only drafts in 'draft' or 'awaiting_portions' can be rejected.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [isMiltonAdmin, membershipRole] = await Promise.all([
    isUserAdminServer(user.id),
    loadMembershipRole(auth.companyId, user.id),
  ]);
  const canManage = canManageKitchenQr({ isMiltonAdmin, membershipRole });
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: draftId } = await params;
  const admin = createAdminClient();

  const { data: updated, error: updateError } = await admin
    .from("kitchen_recipe_drafts")
    .update({
      status: "rejected",
    })
    .eq("id", draftId)
    .eq("company_id", auth.companyId)
    .in("status", ["draft", "awaiting_portions"])
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[reject] update failed");
    return NextResponse.json(
      { error: "Could not reject draft" },
      { status: 500 }
    );
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Draft not found or not in rejectable status" },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
