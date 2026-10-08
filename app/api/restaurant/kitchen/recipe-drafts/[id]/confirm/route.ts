// app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/confirm
//
// Confirms a recipe draft via SECURITY DEFINER function (atomic, idempotent).
// Only Milton admins and owners can confirm (enforced server-side).
// Validates all inputs server-side before calling the function.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";
import { normalizeUnit, convertUnitStr } from "@/lib/restaurant/units";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  dish_name: string;
  portions: number;
  menu_item_id?: string;
  selling_price?: number;
  lines: Array<{
    id: string;
    ingredient_id: string;
    total_quantity: number;
    unit: string;
  }>;
}

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
  const body: ConfirmBody = await req.json();

  const admin = createAdminClient();

  const { data: draft, error: draftError } = await admin
    .from("kitchen_recipe_drafts")
    .select("id, company_id, status, portions")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.company_id !== auth.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (draft.status !== "draft" && draft.status !== "confirmed") {
    return NextResponse.json(
      { error: "Draft must be in draft status to confirm" },
      { status: 400 }
    );
  }

  if (draft.status === "confirmed") {
    const { data: existingRecipe } = await admin
      .from("kitchen_recipe_drafts")
      .select("confirmed_recipe_id, menu_item_id")
      .eq("id", draftId)
      .single();

    return NextResponse.json({
      ok: true,
      recipe_id: existingRecipe?.confirmed_recipe_id,
      menu_item_id: existingRecipe?.menu_item_id,
    });
  }

  if (!body.dish_name || !body.dish_name.trim()) {
    return NextResponse.json(
      { error: "Dish name is required" },
      { status: 400 }
    );
  }

  if (!body.portions || body.portions <= 0) {
    return NextResponse.json(
      { error: "Portions must be a positive integer" },
      { status: 400 }
    );
  }

  if (!body.lines || body.lines.length === 0) {
    return NextResponse.json(
      { error: "At least one ingredient line is required" },
      { status: 400 }
    );
  }

  const { data: draftLines } = await admin
    .from("kitchen_recipe_draft_lines")
    .select("id, ingredient_id")
    .eq("draft_id", draftId);

  const draftLineIds = new Set((draftLines ?? []).map((l) => l.id));

  for (const line of body.lines) {
    if (!draftLineIds.has(line.id)) {
      return NextResponse.json(
        { error: `Line ${line.id} does not belong to this draft` },
        { status: 400 }
      );
    }

    if (!line.ingredient_id) {
      return NextResponse.json(
        { error: "All lines must have a matched ingredient" },
        { status: 400 }
      );
    }

    if (!line.total_quantity || line.total_quantity <= 0) {
      return NextResponse.json(
        { error: "All lines must have a positive quantity" },
        { status: 400 }
      );
    }

    if (!line.unit || !normalizeUnit(line.unit)) {
      return NextResponse.json(
        { error: `Invalid unit: ${line.unit}` },
        { status: 400 }
      );
    }
  }

  const ingredientIds = body.lines.map((l) => l.ingredient_id);
  const { data: ingredients } = await admin
    .from("ingredients")
    .select("id, default_unit")
    .eq("company_id", auth.companyId)
    .in("id", ingredientIds);

  const companyIngredientIds = new Set((ingredients ?? []).map((i) => i.id));

  for (const line of body.lines) {
    if (!companyIngredientIds.has(line.ingredient_id)) {
      return NextResponse.json(
        { error: `Ingredient ${line.ingredient_id} not found` },
        { status: 400 }
      );
    }
  }

  const { data: costEntries } = await admin
    .from("ingredient_cost_entries")
    .select("ingredient_id, normalized_unit_cost, normalized_unit")
    .eq("company_id", auth.companyId)
    .in("ingredient_id", ingredientIds);

  const costMap = new Map<
    string,
    { normalized_unit_cost: number; normalized_unit: string }
  >();
  for (const entry of costEntries ?? []) {
    if (
      !costMap.has(entry.ingredient_id) ||
      (entry.normalized_unit_cost !== null && entry.normalized_unit !== null)
    ) {
      costMap.set(entry.ingredient_id, {
        normalized_unit_cost: entry.normalized_unit_cost,
        normalized_unit: entry.normalized_unit,
      });
    }
  }

  for (const line of body.lines) {
    const cost = costMap.get(line.ingredient_id);
    if (!cost) {
      return NextResponse.json(
        { error: `No cost entry for ingredient ${line.ingredient_id}` },
        { status: 400 }
      );
    }

    const conversion = convertUnitStr(
      line.total_quantity,
      line.unit,
      cost.normalized_unit
    );
    if (!conversion.ok) {
      return NextResponse.json(
        {
          error: `Cannot convert ${line.unit} to ${cost.normalized_unit} for ingredient ${line.ingredient_id}`,
        },
        { status: 400 }
      );
    }
  }

  const preparedLines = body.lines.map((line) => ({
    ingredient_id: line.ingredient_id,
    per_portion_quantity: line.total_quantity / body.portions,
    unit: line.unit,
  }));

  for (const bodyLine of body.lines) {
    await admin
      .from("kitchen_recipe_draft_lines")
      .update({
        total_quantity: bodyLine.total_quantity,
        unit: bodyLine.unit,
        per_portion_quantity: bodyLine.total_quantity / body.portions,
      })
      .eq("id", bodyLine.id);
  }

  try {
    const { data, error } = await admin.rpc("confirm_kitchen_recipe_draft", {
      p_draft_id: draftId,
      p_confirmed_by: user.id,
      p_dish_name: body.dish_name.trim(),
      p_portions: body.portions,
      p_menu_item_id: body.menu_item_id || null,
      p_selling_price: body.selling_price || 0,
      p_lines: preparedLines,
    });

    if (error) {
      console.error("[confirm] RPC failed");
      return NextResponse.json(
        { error: "Could not confirm draft" },
        { status: 500 }
      );
    }

    const result = data?.[0];
    return NextResponse.json({
      ok: true,
      recipe_id: result?.recipe_id,
      menu_item_id: result?.menu_item_id,
    });
  } catch (err) {
    console.error("[confirm] unexpected error");
    return NextResponse.json(
      { error: "Could not confirm draft" },
      { status: 500 }
    );
  }
}
