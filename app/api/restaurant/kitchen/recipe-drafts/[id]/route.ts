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
    .select("id, company_id, status, portions, dish_name")
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
  if (Object.keys(updates).length === 0) {
    updates.dish_name = draft.dish_name;
  }

  const { data: updatedRows, error: updateError } = await admin
    .from("kitchen_recipe_drafts")
    .update(updates)
    .eq("id", draftId)
    .eq("company_id", auth.companyId)
    .in("status", ["draft", "awaiting_portions"])
    .select("id");

  if (updateError) {
    console.error("[recipe-drafts PATCH] update failed");
    return NextResponse.json(
      { error: "Failed to update draft" },
      { status: 500 }
    );
  }

  if (!updatedRows || updatedRows.length !== 1) {
    return NextResponse.json(
      { error: "Draft not found or not in editable status" },
      { status: 409 }
    );
  }

  if (body.lines !== undefined) {
    const portionsForLines = body.portions ?? draft.portions;

    const { data: existingLineRows, error: existingError } = await admin
      .from("kitchen_recipe_draft_lines")
      .select("id")
      .eq("draft_id", draftId);

    if (existingError) {
      console.error("[recipe-drafts PATCH] load lines failed");
      return NextResponse.json(
        { error: "Failed to load lines" },
        { status: 500 }
      );
    }

    const existingIds = new Set((existingLineRows ?? []).map((l) => l.id));
    const isKeepId = (id: string | undefined): id is string =>
      !!id && !id.startsWith("new-");

    for (const line of body.lines) {
      if (isKeepId(line.id) && !existingIds.has(line.id)) {
        return NextResponse.json(
          { error: `Line ${line.id} does not belong to this draft` },
          { status: 400 }
        );
      }
    }

    const keepIds = new Set(
      body.lines.filter((l) => isKeepId(l.id)).map((l) => l.id as string)
    );
    const removeIds = [...existingIds].filter((id) => !keepIds.has(id));
    if (removeIds.length > 0) {
      const { error: deleteError } = await admin
        .from("kitchen_recipe_draft_lines")
        .delete()
        .eq("draft_id", draftId)
        .in("id", removeIds);

      if (deleteError) {
        console.error("[recipe-drafts PATCH] delete lines failed");
        return NextResponse.json(
          { error: "Failed to update lines" },
          { status: 500 }
        );
      }
    }

    const toUpdate = body.lines
      .map((l, idx) => ({ line: l, line_number: idx + 1 }))
      .filter(({ line }) => isKeepId(line.id));
    const toInsert = body.lines
      .map((l, idx) => ({ line: l, line_number: idx + 1 }))
      .filter(({ line }) => !isKeepId(line.id));

    for (const { line, line_number } of toUpdate) {
      const { error: bumpError } = await admin
        .from("kitchen_recipe_draft_lines")
        .update({ line_number: 10000 + line_number })
        .eq("id", line.id)
        .eq("draft_id", draftId);
      if (bumpError) {
        console.error("[recipe-drafts PATCH] bump line_number failed");
        return NextResponse.json(
          { error: "Failed to update lines" },
          { status: 500 }
        );
      }
    }

    for (const { line, line_number } of toUpdate) {
      const { error: lineUpdateError } = await admin
        .from("kitchen_recipe_draft_lines")
        .update({
          raw_name: line.raw_name,
          ingredient_id: line.ingredient_id,
          total_quantity: line.total_quantity,
          unit: line.unit,
          per_portion_quantity:
            line.total_quantity !== null && portionsForLines
              ? line.total_quantity / portionsForLines
              : null,
          line_number,
        })
        .eq("id", line.id)
        .eq("draft_id", draftId);

      if (lineUpdateError) {
        console.error("[recipe-drafts PATCH] update line failed");
        return NextResponse.json(
          { error: "Failed to update lines" },
          { status: 500 }
        );
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await admin
        .from("kitchen_recipe_draft_lines")
        .insert(
          toInsert.map(({ line, line_number }) => ({
            draft_id: draftId,
            company_id: auth.companyId,
            line_number,
            raw_name: line.raw_name,
            ingredient_id: line.ingredient_id,
            total_quantity: line.total_quantity,
            unit: line.unit,
            per_portion_quantity:
              line.total_quantity !== null && portionsForLines
                ? line.total_quantity / portionsForLines
                : null,
            confidence: "low" as const,
          }))
        );

      if (insertError) {
        console.error("[recipe-drafts PATCH] insert lines failed");
        return NextResponse.json(
          { error: "Failed to insert lines" },
          { status: 500 }
        );
      }
    }
  }

  const { data: savedLines, error: reloadError } = await admin
    .from("kitchen_recipe_draft_lines")
    .select("*")
    .eq("draft_id", draftId)
    .order("line_number", { ascending: true });

  if (reloadError) {
    console.error("[recipe-drafts PATCH] reload lines failed");
    return NextResponse.json(
      { error: "Failed to load saved lines" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, lines: savedLines ?? [] });
}
