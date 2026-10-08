// app/api/restaurant/kitchen/recipe-drafts/[id]/route.ts
//
// PATCH /api/restaurant/kitchen/recipe-drafts/:id
//
// Updates a draft's editable fields (dish_name, portions, menu_item_id, lines).
// Only Milton admins and owners can edit (enforced server-side).

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

interface PatchBody {
  dish_name?: string;
  portions?: number;
  menu_item_id?: string;
  lines?: Array<{
    id?: string;
    raw_name: string;
    ingredient_id: string | null;
    total_quantity: number | null;
    unit: string | null;
  }>;
}

export async function PATCH(
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
  const body: PatchBody = await req.json();
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("kitchen_recipe_drafts")
    .select("id, company_id, status")
    .eq("id", draftId)
    .maybeSingle();

  if (!draft || draft.company_id !== auth.companyId) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.status !== "draft" && draft.status !== "awaiting_portions") {
    return NextResponse.json(
      { error: "Can only edit drafts in draft or awaiting_portions status" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (body.dish_name !== undefined) updates.dish_name = body.dish_name;
  if (body.portions !== undefined) updates.portions = body.portions;
  if (body.menu_item_id !== undefined) updates.menu_item_id = body.menu_item_id;

  if (Object.keys(updates).length > 0) {
    await admin.from("kitchen_recipe_drafts").update(updates).eq("id", draftId);
  }

  if (body.lines !== undefined) {
    await admin
      .from("kitchen_recipe_draft_lines")
      .delete()
      .eq("draft_id", draftId);

    const lineRows = body.lines.map((l, idx) => ({
      draft_id: draftId,
      company_id: auth.companyId,
      line_number: idx + 1,
      raw_name: l.raw_name,
      ingredient_id: l.ingredient_id,
      total_quantity: l.total_quantity,
      unit: l.unit,
      per_portion_quantity:
        l.total_quantity !== null && body.portions
          ? l.total_quantity / body.portions
          : null,
      confidence: "low" as const,
    }));

    if (lineRows.length > 0) {
      await admin.from("kitchen_recipe_draft_lines").insert(lineRows);
    }
  }

  return NextResponse.json({ ok: true });
}
