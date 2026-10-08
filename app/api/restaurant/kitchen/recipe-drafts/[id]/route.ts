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
import { normalizeUnit } from "@/lib/restaurant/units";

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
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: draft } = await admin
    .from("kitchen_recipe_drafts")
    .select("id, company_id, status, portions")
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

  if (body.portions !== undefined) {
    if (
      typeof body.portions !== "number" ||
      body.portions <= 0 ||
      !Number.isInteger(body.portions)
    ) {
      return NextResponse.json(
        { error: "Portions must be a positive integer" },
        { status: 400 }
      );
    }
  }

  if (body.dish_name !== undefined && typeof body.dish_name !== "string") {
    return NextResponse.json(
      { error: "Dish name must be a string" },
      { status: 400 }
    );
  }

  if (body.menu_item_id !== undefined && body.menu_item_id !== null) {
    const { data: menuItem } = await admin
      .from("menu_items")
      .select("id")
      .eq("id", body.menu_item_id)
      .eq("company_id", auth.companyId)
      .maybeSingle();

    if (!menuItem) {
      return NextResponse.json(
        { error: "Menu item not found or does not belong to your company" },
        { status: 400 }
      );
    }
  }

  if (body.lines !== undefined) {
    if (!Array.isArray(body.lines)) {
      return NextResponse.json(
        { error: "Lines must be an array" },
        { status: 400 }
      );
    }

    for (const line of body.lines) {
      if (!line || typeof line.raw_name !== "string") {
        return NextResponse.json(
          { error: "Each line must have a raw_name string" },
          { status: 400 }
        );
      }
      if (
        line.total_quantity !== null &&
        line.total_quantity !== undefined &&
        (typeof line.total_quantity !== "number" || line.total_quantity <= 0)
      ) {
        return NextResponse.json(
          { error: "Line quantities must be positive numbers" },
          { status: 400 }
        );
      }
      if (
        line.unit !== null &&
        line.unit !== undefined &&
        line.unit !== "" &&
        !normalizeUnit(line.unit)
      ) {
        return NextResponse.json(
          { error: `Invalid unit: ${line.unit}` },
          { status: 400 }
        );
      }
    }

    const ingredientIds = body.lines
      .filter((l) => l.ingredient_id !== null)
      .map((l) => l.ingredient_id!);

    if (ingredientIds.length > 0) {
      const { data: ingredients } = await admin
        .from("ingredients")
        .select("id")
        .eq("company_id", auth.companyId)
        .in("id", ingredientIds);

      const companyIngredientIds = new Set(
        (ingredients ?? []).map((i) => i.id)
      );

      for (const line of body.lines) {
        if (
          line.ingredient_id !== null &&
          !companyIngredientIds.has(line.ingredient_id)
        ) {
          return NextResponse.json(
            {
              error: `Ingredient ${line.ingredient_id} not found or does not belong to your company`,
            },
            { status: 400 }
          );
        }
      }
    }
  }

  const updates: Record<string, unknown> = {};
  if (body.dish_name !== undefined) updates.dish_name = body.dish_name;
  if (body.portions !== undefined) {
    updates.portions = body.portions;
    if (draft.status === "awaiting_portions") {
      updates.status = "draft";
    }
  }
  if (body.menu_item_id !== undefined) updates.menu_item_id = body.menu_item_id;

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await admin
      .from("kitchen_recipe_drafts")
      .update(updates)
      .eq("id", draftId);

    if (updateError) {
      console.error("[recipe-drafts PATCH] update failed");
      return NextResponse.json(
        { error: "Failed to update draft" },
        { status: 500 }
      );
    }
  }

  if (body.lines !== undefined) {
    const { error: deleteError } = await admin
      .from("kitchen_recipe_draft_lines")
      .delete()
      .eq("draft_id", draftId);

    if (deleteError) {
      console.error("[recipe-drafts PATCH] delete lines failed");
      return NextResponse.json(
        { error: "Failed to update lines" },
        { status: 500 }
      );
    }

    const portionsForLines = body.portions ?? draft.portions;
    const lineRows = body.lines.map((l, idx) => ({
      draft_id: draftId,
      company_id: auth.companyId,
      line_number: idx + 1,
      raw_name: l.raw_name,
      ingredient_id: l.ingredient_id,
      total_quantity: l.total_quantity,
      unit: l.unit,
      per_portion_quantity:
        l.total_quantity !== null && portionsForLines
          ? l.total_quantity / portionsForLines
          : null,
      confidence: "low" as const,
    }));

    if (lineRows.length > 0) {
      const { error: insertError } = await admin
        .from("kitchen_recipe_draft_lines")
        .insert(lineRows);

      if (insertError) {
        console.error("[recipe-drafts PATCH] insert lines failed");
        return NextResponse.json(
          { error: "Failed to insert lines" },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({ ok: true });
}
