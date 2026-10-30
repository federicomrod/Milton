// /api/restaurant/ingredients/unit-conversions
//   GET    ?ingredient_id=<uuid>                      → { conversions: [...] }
//   POST   { ingredient_id, from_unit, to_unit, factor } → define «1 from = factor to»
//   DELETE { id }
//
// One price, several units (migration 056): «1 taza de PAPAS FRANCESAS = 5 oz».
// ONE direction is stored; the inverse is derived by costing. Defining the
// opposite direction replaces the existing one. A pair the standard unit table
// already converts (oz ↔ lb) is refused: this is only for what the table cannot
// know. Company and user come from auth; RLS (is_company_member) is the guard.

import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { fmt } from "@/lib/i18n";
import { actionableError } from "@/lib/restaurant/actionable-error";
import { convertToSubRecipeUnit, sameUnit } from "@/lib/restaurant/units";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, ingredient_id, from_unit, to_unit, factor, created_at";
async function failure(
  error: { code?: string; message?: string },
  fallback: string,
  tag: string
) {
  const api = (await apiDictionary()).menu.screens.api;
  // 42P01 = the table does not exist yet (migration 056 not applied).
  if (error.code === "42P01") {
    return NextResponse.json(
      { unavailable: true, error: api.migration056 },
      { status: 409 }
    );
  }
  if (error.code === "42501") {
    return NextResponse.json({ error: api.noPermission }, { status: 403 });
  }
  if (error.code === "22023") {
    return NextResponse.json(
      { error: error.message ?? fallback },
      { status: 400 }
    );
  }
  const f = actionableError(error as never, fallback, tag);
  return NextResponse.json(
    { error: f.message, ref: f.ref },
    { status: f.status }
  );
}

function cleanUnitText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return text && text.length <= 24 ? text : null;
}

export async function GET(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const ingredientId = new URL(req.url).searchParams.get("ingredient_id");
  if (!ingredientId || !UUID.test(ingredientId)) {
    return NextResponse.json({ error: api.specifyIngredient }, { status: 400 });
  }
  const { data, error } = await auth.supabase
    .from("ingredient_unit_conversions")
    .select(COLUMNS)
    .eq("company_id", auth.companyId)
    .eq("ingredient_id", ingredientId)
    .order("created_at", { ascending: true });
  if (error) {
    // Before the migration there is nothing to list.
    if (error.code === "42P01")
      return NextResponse.json({ conversions: [], unavailable: true });
    return failure(error, api.readConversions, "unit-conversions-get");
  }
  return NextResponse.json({ conversions: data ?? [] });
}

export async function POST(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit", {
    message: api.rolePrices,
  });
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }
  const ingredientId =
    typeof body.ingredient_id === "string" && UUID.test(body.ingredient_id)
      ? body.ingredient_id
      : null;
  const from = cleanUnitText(body.from_unit);
  const to = cleanUnitText(body.to_unit);
  const factor = Number(body.factor);
  if (!ingredientId || !from || !to) {
    return NextResponse.json({ error: api.twoUnits }, { status: 400 });
  }
  if (sameUnit(from, to)) {
    return NextResponse.json({ error: api.sameUnits }, { status: 400 });
  }
  if (!(factor > 0) || !Number.isFinite(factor)) {
    return NextResponse.json({ error: api.factorPositive }, { status: 400 });
  }
  if (convertToSubRecipeUnit(1, from, to).ok) {
    return NextResponse.json(
      {
        error: fmt(api.standardExists, { from, to }),
      },
      { status: 400 }
    );
  }

  // The opposite direction is the same bridge: replace it, never keep both.
  const inverse = await auth.supabase
    .from("ingredient_unit_conversions")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("ingredient_id", ingredientId)
    .eq("from_unit", to)
    .eq("to_unit", from);
  if (inverse.error)
    return failure(
      inverse.error,
      api.saveConversion,
      "unit-conversions-inverse"
    );

  const { data, error } = await auth.supabase
    .from("ingredient_unit_conversions")
    .upsert(
      {
        company_id: auth.companyId,
        ingredient_id: ingredientId,
        from_unit: from,
        to_unit: to,
        factor,
        created_by: auth.userId,
      },
      { onConflict: "ingredient_id,from_unit,to_unit" }
    )
    .select(COLUMNS)
    .single();
  if (error || !data)
    return failure(error ?? {}, api.saveConversion, "unit-conversions-post");
  return NextResponse.json({ conversion: data });
}

export async function DELETE(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit", {
    message: api.rolePrices,
  });
  if (denied) return denied;
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }
  if (typeof body.id !== "string" || !UUID.test(body.id)) {
    return NextResponse.json({ error: api.specifyConversion }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("ingredient_unit_conversions")
    .delete()
    .eq("company_id", auth.companyId)
    .eq("id", body.id);
  if (error)
    return failure(error, api.removeConversion, "unit-conversions-delete");
  return NextResponse.json({ ok: true });
}
