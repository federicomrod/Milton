// app/api/restaurant/kitchen/recipe-drafts/[id]/reject/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/reject
//
// Rejects a recipe draft (marks status 'rejected'). Owners, admins,
// managers and Milton staff can reject (enforced server-side). Uses admin client after
// role check. Only drafts in 'draft' or 'awaiting_portions' can be rejected.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { KITCHEN_FORBIDDEN_MESSAGE } from "@/lib/restaurant/telegram/kitchen-manager-guard";
import {
  requireCapability,
  resolveActor,
  unauthorizedResponse,
} from "@/lib/auth/permissions";

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
  if (!user) return unauthorizedResponse();

  const actor = await resolveActor(null, user.id, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "kitchen.drafts", {
    message: KITCHEN_FORBIDDEN_MESSAGE,
  });
  if (denied) return denied;

  const { id: draftId } = await params;
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("kitchen_recipe_drafts")
    .select("id, company_id")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft || draft.company_id !== auth.companyId) {
    return NextResponse.json(
      { error: "No encontré el borrador." },
      { status: 404 }
    );
  }

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
      { error: "No pude rechazar el borrador." },
      { status: 500 }
    );
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Ese borrador ya no se puede rechazar." },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true });
}
