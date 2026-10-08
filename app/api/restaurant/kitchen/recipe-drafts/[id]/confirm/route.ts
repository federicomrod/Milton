// app/api/restaurant/kitchen/recipe-drafts/[id]/confirm/route.ts
//
// POST /api/restaurant/kitchen/recipe-drafts/:id/confirm
//
// Confirms a recipe draft: writes to recipes (status 'active') and
// menu_recipe_inputs. Idempotent (double confirm is a no-op). Only
// Milton admins and owners can confirm (enforced server-side).

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  canManageKitchenQr,
  loadMembershipRole,
} from "@/lib/restaurant/telegram/kitchen-join";

export const dynamic = "force-dynamic";

interface ConfirmBody {
  dish_name: string;
  portions: number;
  lines: Array<{
    id: string;
    ingredient_id: string | null;
    total_quantity: number | null;
    unit: string | null;
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

  const body: ConfirmBody = await req.json();
  const { id: draftId } = await params;

  const { data: draft, error: draftError } = await supabase
    .from("kitchen_recipe_drafts")
    .select("id, company_id, status, confirmed_recipe_id, menu_item_id")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError || !draft) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  if (draft.company_id !== auth.companyId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (draft.status === "confirmed" && draft.confirmed_recipe_id) {
    return NextResponse.json({
      ok: true,
      recipe_id: draft.confirmed_recipe_id,
    });
  }

  for (const line of body.lines) {
    if (!line.ingredient_id || !line.total_quantity) {
      return NextResponse.json(
        { error: "All lines must have matched ingredient and quantity." },
        { status: 400 }
      );
    }
  }

  let menuItemId = draft.menu_item_id;
  if (!menuItemId) {
    const { data: newItem, error: itemError } = await supabase
      .from("menu_items")
      .insert({
        company_id: auth.companyId,
        name: body.dish_name,
        category: "Main",
      })
      .select("id")
      .single();

    if (itemError || !newItem) {
      console.error("[confirm] menu item insert failed:", itemError?.message);
      return NextResponse.json(
        { error: "Could not create menu item." },
        { status: 500 }
      );
    }
    menuItemId = newItem.id;
  }

  const { data: newRecipe, error: recipeError } = await supabase
    .from("recipes")
    .insert({
      company_id: auth.companyId,
      menu_item_id: menuItemId,
      status: "active",
      yield_quantity: body.portions,
      serving_size: 1,
      serving_unit: "porción",
    })
    .select("id")
    .single();

  if (recipeError || !newRecipe) {
    console.error("[confirm] recipe insert failed:", recipeError?.message);
    return NextResponse.json(
      { error: "Could not create recipe." },
      { status: 500 }
    );
  }

  const inputRows = body.lines.map((line) => ({
    recipe_id: newRecipe.id,
    input_type: "ingredient" as const,
    ingredient_id: line.ingredient_id,
    component_id: null,
    quantity: line.total_quantity,
    unit: line.unit ?? "g",
  }));

  const { error: inputsError } = await supabase
    .from("menu_recipe_inputs")
    .insert(inputRows);

  if (inputsError) {
    console.error("[confirm] inputs insert failed:", inputsError.message);
    return NextResponse.json(
      { error: "Could not create recipe inputs." },
      { status: 500 }
    );
  }

  const { error: updateError } = await supabase
    .from("kitchen_recipe_drafts")
    .update({
      status: "confirmed",
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
      confirmed_recipe_id: newRecipe.id,
      menu_item_id: menuItemId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId);

  if (updateError) {
    console.error("[confirm] draft update failed:", updateError.message);
  }

  return NextResponse.json({ ok: true, recipe_id: newRecipe.id });
}
