// app/api/restaurant/recipes/menu-item/[id]/route.ts
//
// GET  /api/restaurant/recipes/menu-item/:id
//   → { recipe: Recipe | null, inputs: MenuRecipeInput[] }
//
// PUT  /api/restaurant/recipes/menu-item/:id
//   → upsert the recipe header and REPLACE its inputs in one call.
//
// We intentionally implement "replace inputs" rather than fine-grained
// add/remove/update because the recipe builder UI submits the whole
// edited input list anyway. Simpler client, cheaper to reason about,
// and the input table has no other code referencing input ids.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface InputBody {
  input_type?: unknown;
  ingredient_id?: unknown;
  component_id?: unknown;
  quantity?: unknown;
  unit?: unknown;
  notes?: unknown;
}

interface PutBody {
  status?: unknown;
  serving_quantity?: unknown;
  serving_unit?: unknown;
  notes?: unknown;
  inputs?: InputBody[];
}

const ALLOWED_STATUSES = new Set(["draft", "active", "archived"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: menuItemId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  // Recipe header (may not exist yet).
  const { data: recipe, error: recipeErr } = await auth.supabase
    .from("recipes")
    .select(
      "id, menu_item_id, status, serving_quantity, serving_unit, notes, version"
    )
    .eq("company_id", auth.companyId)
    .eq("menu_item_id", menuItemId)
    .maybeSingle();

  if (recipeErr) {
    console.error("[recipes/menu-item GET]", recipeErr.message);
    return NextResponse.json(
      { error: "Read failed", details: recipeErr.message },
      { status: 500 }
    );
  }

  if (!recipe) {
    return NextResponse.json({ recipe: null, inputs: [] });
  }

  const { data: inputs, error: inputsErr } = await auth.supabase
    .from("menu_recipe_inputs")
    .select(
      "id, input_type, ingredient_id, component_id, quantity, unit, notes"
    )
    .eq("company_id", auth.companyId)
    .eq("recipe_id", recipe.id);

  if (inputsErr) {
    console.error("[recipes/menu-item GET inputs]", inputsErr.message);
    return NextResponse.json(
      { error: "Read failed", details: inputsErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ recipe, inputs: inputs ?? [] });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: menuItemId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // ---- Validate header fields -------------------------------------------
  const status =
    typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)
      ? (body.status as "draft" | "active" | "archived")
      : "draft";
  const servingQuantity =
    typeof body.serving_quantity === "number" &&
    Number.isFinite(body.serving_quantity) &&
    body.serving_quantity > 0
      ? body.serving_quantity
      : 1;
  const servingUnit =
    typeof body.serving_unit === "string" && body.serving_unit.trim() !== ""
      ? body.serving_unit.trim()
      : "portion";
  const notes =
    typeof body.notes === "string" && body.notes.trim() !== ""
      ? body.notes.trim()
      : null;

  // ---- Validate inputs --------------------------------------------------
  const rawInputs = Array.isArray(body.inputs) ? body.inputs : [];
  const inputs: {
    company_id: string;
    recipe_id: string;
    input_type: "ingredient" | "component";
    ingredient_id: string | null;
    component_id: string | null;
    quantity: number;
    unit: string;
    notes: string | null;
  }[] = [];

  for (let i = 0; i < rawInputs.length; i++) {
    const raw = rawInputs[i];
    const inputType = raw.input_type;
    if (inputType !== "ingredient" && inputType !== "component") {
      return NextResponse.json(
        {
          error: `inputs[${i}].input_type must be 'ingredient' or 'component'`,
        },
        { status: 400 }
      );
    }
    const ingredientId =
      typeof raw.ingredient_id === "string" && raw.ingredient_id.trim() !== ""
        ? raw.ingredient_id
        : null;
    const componentId =
      typeof raw.component_id === "string" && raw.component_id.trim() !== ""
        ? raw.component_id
        : null;
    if (inputType === "ingredient" && (!ingredientId || componentId)) {
      return NextResponse.json(
        { error: `inputs[${i}]: ingredient inputs need ingredient_id only` },
        { status: 400 }
      );
    }
    if (inputType === "component" && (!componentId || ingredientId)) {
      return NextResponse.json(
        { error: `inputs[${i}]: component inputs need component_id only` },
        { status: 400 }
      );
    }
    const quantity =
      typeof raw.quantity === "number" ? raw.quantity : Number(raw.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: `inputs[${i}]: quantity must be a positive number` },
        { status: 400 }
      );
    }
    const unit = typeof raw.unit === "string" ? raw.unit.trim() : "";
    if (!unit) {
      return NextResponse.json(
        { error: `inputs[${i}]: unit is required` },
        { status: 400 }
      );
    }
    inputs.push({
      // recipe_id is filled in below once we know the recipe header id.
      company_id: auth.companyId,
      recipe_id: "",
      input_type: inputType,
      ingredient_id: ingredientId,
      component_id: componentId,
      quantity,
      unit,
      notes:
        typeof raw.notes === "string" && raw.notes.trim() !== ""
          ? raw.notes.trim()
          : null,
    });
  }

  // ---- Resolve the menu item (also gives us a sane default for recipe.name) -
  // Fetching the menu item up front does two things:
  //   1. Confirms the menu_item exists and belongs to this company (RLS
  //      would also catch it, but a clear 404 beats a 500).
  //   2. Gives us a sensible value for `recipes.name`. The legacy
  //      `recipes` table on real tenants almost always has a NOT NULL
  //      `name` column that we don't track in TS — supplying it from the
  //      menu item name removes a class of "null value in column 'name'"
  //      insert failures.
  const { data: menuItem, error: menuItemErr } = await auth.supabase
    .from("menu_items")
    .select("id, name")
    .eq("company_id", auth.companyId)
    .eq("id", menuItemId)
    .maybeSingle();
  if (menuItemErr) {
    console.error("[recipes/menu-item PUT menu_item lookup]", menuItemErr);
    return NextResponse.json(
      buildPgErrorBody("Could not load menu item", menuItemErr),
      { status: 500 }
    );
  }
  if (!menuItem) {
    return NextResponse.json(
      { error: "Menu item not found for this company" },
      { status: 404 }
    );
  }

  // ---- Upsert recipe header ---------------------------------------------
  const { data: existing } = await auth.supabase
    .from("recipes")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("menu_item_id", menuItemId)
    .maybeSingle();

  let recipeId: string;
  if (existing?.id) {
    recipeId = existing.id;
    const { error } = await auth.supabase
      .from("recipes")
      .update({
        status,
        serving_quantity: servingQuantity,
        serving_unit: servingUnit,
        notes,
      })
      .eq("id", recipeId);
    if (error) {
      console.error("[recipes/menu-item PUT update]", error);
      return NextResponse.json(
        buildPgErrorBody("Recipe update failed", error),
        { status: 500 }
      );
    }
  } else {
    // Defensive insert. We always supply `name` so legacy NOT-NULL columns
    // don't trip the insert. If the column doesn't exist Supabase ignores
    // unknown keys silently for inserts? It does NOT — PostgREST rejects
    // unknown columns. If your `recipes` table lacks a `name` column the
    // request will fail; remove the key in that case.
    const { data: created, error } = await auth.supabase
      .from("recipes")
      .insert({
        company_id: auth.companyId,
        menu_item_id: menuItemId,
        name: menuItem.name,
        status,
        serving_quantity: servingQuantity,
        serving_unit: servingUnit,
        notes,
        version: 1,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[recipes/menu-item PUT insert]", error);
      return NextResponse.json(
        buildPgErrorBody("Recipe insert failed", error),
        { status: 500 }
      );
    }
    recipeId = created.id;
  }

  // ---- Replace inputs ---------------------------------------------------
  // Two-step: delete existing, then bulk insert new. Safe because inputs
  // are referenced by `id` only by themselves — no FK from other tables.
  const { error: delErr } = await auth.supabase
    .from("menu_recipe_inputs")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("recipe_id", recipeId);
  if (delErr) {
    console.error("[recipes/menu-item PUT delete inputs]", delErr);
    return NextResponse.json(
      buildPgErrorBody("Could not clear existing inputs", delErr),
      { status: 500 }
    );
  }

  if (inputs.length > 0) {
    const payload = inputs.map((i) => ({ ...i, recipe_id: recipeId }));
    const { error: insErr } = await auth.supabase
      .from("menu_recipe_inputs")
      .insert(payload);
    if (insErr) {
      console.error("[recipes/menu-item PUT insert inputs]", insErr);
      return NextResponse.json(
        buildPgErrorBody("Could not write inputs", insErr),
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    recipe_id: recipeId,
    inputs_written: inputs.length,
    status,
  });
}

/**
 * Builds a JSON error body that preserves the full Supabase/Postgres
 * error context so the dashboard can show users (and us) the actual
 * cause — `null value in column X violates not-null constraint`,
 * `duplicate key value violates unique constraint`, etc. — instead of
 * just our top-line "Recipe insert failed".
 *
 * We use `unknown` for the error because supabase-js may give us a
 * PostgrestError, a regular Error, or `null` at the type level.
 */
function buildPgErrorBody(
  label: string,
  err: unknown
): Record<string, unknown> {
  const e = (err ?? {}) as {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  };
  return {
    error: label,
    // `details` historically held just the message; we now include the
    // whole bag so the client can surface whichever fields are present.
    details: e.message ?? null,
    pg: {
      message: e.message ?? null,
      code: e.code ?? null,
      details: e.details ?? null,
      hint: e.hint ?? null,
    },
  };
}
