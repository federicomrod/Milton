// app/api/restaurant/kitchen/recipe-drafts/[id]/reject/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/reject
//
// Rejects a recipe draft (marks status 'rejected'). Only Milton admins
// and owners can reject (enforced server-side).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
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

  const { data: draft, error: draftError } = await supabase
    .from("kitchen_recipe_drafts")
    .select("id, company_id")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  if (draft.company_id !== auth.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("kitchen_recipe_drafts")
    .update({
      status: "rejected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  if (updateError) {
    console.error("[reject] draft update failed:", updateError.message);
    return NextResponse.json(
      { error: "Could not reject draft." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
