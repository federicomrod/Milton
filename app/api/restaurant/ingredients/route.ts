// app/api/restaurant/ingredients/route.ts
//
// GET  /api/restaurant/ingredients  → { ingredients: [...] }
// POST /api/restaurant/ingredients  → create one ingredient
//
// Cost tracking is intentionally OUT of scope for this milestone — we
// write `current_unit_cost: null` (pending price after migration 037).
// The UI never asks the user for a cost.

import { fetchIngredientLatestCosts } from "@/lib/restaurant/menu-recipes-server";
import { apiDictionary } from "@/lib/restaurant/api-lang";
import { NextRequest, NextResponse } from "next/server";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  currencyMismatchReason,
  resolveCompanyCurrency,
  resolveWriteCurrency,
} from "@/lib/restaurant/currency";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  // ?activos=1: pickers never offer an archived (merged or hidden) ingredient.
  const onlyActive = new URL(req.url).searchParams.get("activos") === "1";
  const read = (withArchive: boolean) => {
    const q = auth.supabase
      .from("ingredients")
      .select(
        "id, name, category, default_unit, currency, created_at, updated_at"
      )
      .eq("company_id", auth.companyId)
      .order("name", { ascending: true });
    return withArchive ? q.is("archived_at", null) : q;
  };
  let { data, error } = await read(onlyActive);
  // Before migration 050 there is no archive: nothing is hidden.
  if (error && onlyActive && /archived_at/.test(error.message ?? "")) {
    ({ data, error } = await read(false));
  }

  if (error) {
    console.error("[ingredients GET]", error.message);
    return NextResponse.json(
      { error: api.readFailed, details: error.message },
      { status: 500 }
    );
  }
  // `latest_unit_cost` is the ingredient's latest cost entry (the one price),
  // never the legacy ingredients.current_unit_cost cache. No entry = null.
  const latest = new Map(
    (await fetchIngredientLatestCosts(auth.supabase, auth.companyId)).map(
      (row) => [row.id, row.latest?.normalized_unit_cost ?? null]
    )
  );
  return NextResponse.json({
    ingredients: (data ?? []).map((row) => ({
      ...row,
      latest_unit_cost: latest.get(row.id as string) ?? null,
    })),
  });
}

interface CreateBody {
  name?: unknown;
  category?: unknown;
  default_unit?: unknown;
  currency?: unknown;
}

export async function POST(req: NextRequest) {
  const api = (await apiDictionary()).menu.screens.api;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "ingredients.manage");
  if (denied) return denied;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: api.bodyJson }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: api.nameRequired }, { status: 400 });
  }
  const category =
    typeof body.category === "string" && body.category.trim() !== ""
      ? body.category.trim()
      : "uncategorized";
  const defaultUnit =
    typeof body.default_unit === "string" && body.default_unit.trim() !== ""
      ? body.default_unit.trim()
      : "kg";
  const companyCurrency = await resolveCompanyCurrency(
    auth.supabase,
    auth.companyId
  );
  const currency = resolveWriteCurrency(body.currency, companyCurrency);
  const mismatch = currencyMismatchReason(currency, companyCurrency);
  if (mismatch) {
    return NextResponse.json({ error: mismatch }, { status: 400 });
  }

  const { data, error } = await auth.supabase
    .from("ingredients")
    .insert({
      company_id: auth.companyId,
      name,
      category,
      default_unit: defaultUnit,
      // Pending price — never $0. Migration 037 made this column nullable.
      // LEGACY column, written only (a new ingredient has no price): never read.
      current_unit_cost: null,
      currency,
    })
    .select("id, name, category, default_unit, current_unit_cost, currency")
    .single();

  if (error || !data) {
    console.error("[ingredients POST]", error?.message);
    return NextResponse.json(
      { error: api.createFailed, details: error?.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ ingredient: data });
}
