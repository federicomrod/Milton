// app/api/restaurant/recipes/component/[id]/route.ts
//
// GET /api/restaurant/recipes/component/:component_id
//   → { recipe, inputs }
//
// PUT /api/restaurant/recipes/component/:component_id
//   Upsert the component recipe header (one per component) and REPLACE
//   its inputs in one call — mirrors the menu-item recipe route's
//   "replace inputs" contract.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "active", "archived"]);

interface InputBody {
  input_type?: unknown;
  ingredient_id?: unknown;
  component_id?: unknown;
  quantity?: unknown;
  unit?: unknown;
  notes?: unknown;
}

interface PutBody {
  name?: unknown;
  output_quantity?: unknown;
  output_unit?: unknown;
  yield_percentage?: unknown;
  status?: unknown;
  inputs?: InputBody[];
}

function pgErr(label: string, err: unknown): Record<string, unknown> {
  const e = (err ?? {}) as {
    message?: string;
    code?: string;
    details?: string;
    hint?: string;
  };
  return {
    error: label,
    details: e.message ?? null,
    pg: {
      message: e.message ?? null,
      code: e.code ?? null,
      details: e.details ?? null,
      hint: e.hint ?? null,
    },
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: componentId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const { data: recipe, error: recipeErr } = await auth.supabase
    .from("component_recipes")
    .select(
      "id, component_id, name, output_quantity, output_unit, yield_percentage, status"
    )
    .eq("company_id", auth.companyId)
    .eq("component_id", componentId)
    .maybeSingle();

  if (recipeErr) {
    console.error("[recipes/component GET]", recipeErr);
    return NextResponse.json(pgErr("Read failed", recipeErr), { status: 500 });
  }
  if (!recipe) return NextResponse.json({ recipe: null, inputs: [] });

  const { data: inputs, error: inputsErr } = await auth.supabase
    .from("component_recipe_inputs")
    .select(
      "id, input_type, ingredient_id, component_id, quantity, unit, notes"
    )
    .eq("company_id", auth.companyId)
    .eq("component_recipe_id", recipe.id);
  if (inputsErr) {
    console.error("[recipes/component GET inputs]", inputsErr);
    return NextResponse.json(pgErr("Read failed", inputsErr), { status: 500 });
  }
  return NextResponse.json({ recipe, inputs: inputs ?? [] });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: componentId } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // ---- Header validation ------------------------------------------------
  const outputQuantity =
    typeof body.output_quantity === "number"
      ? body.output_quantity
      : Number(body.output_quantity);
  if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) {
    return NextResponse.json(
      { error: "output_quantity must be a positive number" },
      { status: 400 }
    );
  }
  const outputUnit =
    typeof body.output_unit === "string" && body.output_unit.trim() !== ""
      ? body.output_unit.trim()
      : "";
  if (!outputUnit) {
    return NextResponse.json(
      { error: "output_unit is required" },
      { status: 400 }
    );
  }
  const status =
    typeof body.status === "string" && ALLOWED_STATUSES.has(body.status)
      ? (body.status as "draft" | "active" | "archived")
      : "draft";
  const yieldPercentage =
    typeof body.yield_percentage === "number" &&
    Number.isFinite(body.yield_percentage) &&
    body.yield_percentage > 0 &&
    body.yield_percentage <= 100
      ? body.yield_percentage
      : null;

  // ---- Resolve component (we need its name as a recipe-name default) ----
  const { data: component, error: compErr } = await auth.supabase
    .from("prepared_components")
    .select("id, name")
    .eq("company_id", auth.companyId)
    .eq("id", componentId)
    .maybeSingle();
  if (compErr) {
    return NextResponse.json(pgErr("Could not load component", compErr), {
      status: 500,
    });
  }
  if (!component) {
    return NextResponse.json(
      { error: "Component not found for this company" },
      { status: 404 }
    );
  }
  const recipeName =
    typeof body.name === "string" && body.name.trim() !== ""
      ? body.name.trim()
      : `${component.name} recipe`;

  // ---- Validate inputs --------------------------------------------------
  const rawInputs = Array.isArray(body.inputs) ? body.inputs : [];
  const inputs: {
    company_id: string;
    component_recipe_id: string;
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
      typeof raw.ingredient_id === "string" && raw.ingredient_id !== ""
        ? raw.ingredient_id
        : null;
    const inputComponentId =
      typeof raw.component_id === "string" && raw.component_id !== ""
        ? raw.component_id
        : null;
    if (inputType === "ingredient" && (!ingredientId || inputComponentId)) {
      return NextResponse.json(
        { error: `inputs[${i}]: ingredient input requires ingredient_id only` },
        { status: 400 }
      );
    }
    if (inputType === "component" && (!inputComponentId || ingredientId)) {
      return NextResponse.json(
        { error: `inputs[${i}]: component input requires component_id only` },
        { status: 400 }
      );
    }
    if (inputType === "component" && inputComponentId === componentId) {
      // Self-reference would be a direct cycle; the engine catches deeper
      // cycles via the visit-stack but we can refuse the obvious case here.
      return NextResponse.json(
        { error: `inputs[${i}]: a component recipe cannot consume itself` },
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
      company_id: auth.companyId,
      component_recipe_id: "",
      input_type: inputType,
      ingredient_id: ingredientId,
      component_id: inputComponentId,
      quantity,
      unit,
      notes:
        typeof raw.notes === "string" && raw.notes.trim() !== ""
          ? raw.notes.trim()
          : null,
    });
  }

  // ---- Upsert recipe header --------------------------------------------
  const { data: existing } = await auth.supabase
    .from("component_recipes")
    .select("id")
    .eq("company_id", auth.companyId)
    .eq("component_id", componentId)
    .maybeSingle();

  let recipeId: string;
  if (existing?.id) {
    recipeId = existing.id;
    const { error } = await auth.supabase
      .from("component_recipes")
      .update({
        name: recipeName,
        output_quantity: outputQuantity,
        output_unit: outputUnit,
        yield_percentage: yieldPercentage,
        status,
      })
      .eq("id", recipeId);
    if (error) {
      console.error("[recipes/component PUT update]", error);
      return NextResponse.json(pgErr("Recipe update failed", error), {
        status: 500,
      });
    }
  } else {
    const { data: created, error } = await auth.supabase
      .from("component_recipes")
      .insert({
        company_id: auth.companyId,
        component_id: componentId,
        name: recipeName,
        output_quantity: outputQuantity,
        output_unit: outputUnit,
        yield_percentage: yieldPercentage,
        status,
      })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[recipes/component PUT insert]", error);
      return NextResponse.json(pgErr("Recipe insert failed", error), {
        status: 500,
      });
    }
    recipeId = created.id;
  }

  // ---- Replace inputs ---------------------------------------------------
  const { error: delErr } = await auth.supabase
    .from("component_recipe_inputs")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("component_recipe_id", recipeId);
  if (delErr) {
    return NextResponse.json(pgErr("Could not clear existing inputs", delErr), {
      status: 500,
    });
  }

  if (inputs.length > 0) {
    const payload = inputs.map((i) => ({
      ...i,
      component_recipe_id: recipeId,
    }));
    const { error: insErr } = await auth.supabase
      .from("component_recipe_inputs")
      .insert(payload);
    if (insErr) {
      return NextResponse.json(pgErr("Could not write inputs", insErr), {
        status: 500,
      });
    }
  }

  return NextResponse.json({
    recipe_id: recipeId,
    inputs_written: inputs.length,
    status,
  });
}
