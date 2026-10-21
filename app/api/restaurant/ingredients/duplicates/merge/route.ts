// POST /api/restaurant/ingredients/duplicates/merge
//   { survivor_id, loser_ids: [uuid], chosen_cost_entry_id?, suggestion_id? }
//
// R1-15k: Unir. One transaction in the database (ingredient_merge, 051):
// repoints every recipe line, price and invoice match, remembers the losers'
// names as aliases (the importer reads them), archives the losers, writes the
// undo record. The aliases are made here from the names in the database, never
// from the request.

import { requireCapability } from "@/lib/auth/permissions";
import { NextRequest, NextResponse } from "next/server";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
import { mergeUnitMismatch } from "@/lib/restaurant/ingredient-duplicates";
import {
  UUID,
  failureResponse,
  gate,
} from "@/lib/restaurant/ingredient-duplicates-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const g = await gate();
  if (!g.ok) return g.response;
  const denied = requireCapability(g.actor, "ingredients.manage", {
    message: "Tu rol no puede unir ni descartar ingredientes.",
  });
  if (denied) return denied;
  const { supabase, companyId } = g.auth;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const survivor = body.survivor_id;
  const losers = Array.isArray(body.loser_ids)
    ? [
        ...new Set(
          body.loser_ids.filter(
            (x): x is string => typeof x === "string" && UUID.test(x)
          )
        ),
      ]
    : [];
  const chosen =
    typeof body.chosen_cost_entry_id === "string" &&
    UUID.test(body.chosen_cost_entry_id)
      ? body.chosen_cost_entry_id
      : null;
  const suggestion =
    typeof body.suggestion_id === "string" && UUID.test(body.suggestion_id)
      ? body.suggestion_id
      : null;
  if (
    typeof survivor !== "string" ||
    !UUID.test(survivor) ||
    losers.length < 1 ||
    losers.length > 20
  ) {
    return NextResponse.json(
      { error: "Elige el ingrediente que se conserva y 1 a 20 por unir." },
      { status: 400 }
    );
  }
  // The losers' names and every unit, from the database.
  const names = await supabase
    .from("ingredients")
    .select("id, name, default_unit")
    .eq("company_id", companyId)
    .in("id", [...losers, survivor]);
  if (names.error)
    return failureResponse(
      names.error,
      "No pude leer los ingredientes.",
      "ingredient-merge"
    );
  const rows = (names.data ?? []) as Array<{
    id: string;
    name: string;
    default_unit: string | null;
  }>;
  // Unit families, in the route as well as in the database: a mismatch is
  // refused before anything is written, with a clear message.
  const needUnit = rows.filter((r) => !r.default_unit).map((r) => r.id);
  const latestUnit = new Map<string, string>();
  if (needUnit.length > 0) {
    const entries = await supabase
      .from("ingredient_cost_entries")
      .select("ingredient_id, normalized_unit")
      .eq("company_id", companyId)
      .in("ingredient_id", needUnit)
      .order("cost_date", { ascending: false })
      .limit(5000);
    for (const e of (entries.data ?? []) as Array<{
      ingredient_id: string;
      normalized_unit: string;
    }>)
      if (!latestUnit.has(e.ingredient_id))
        latestUnit.set(e.ingredient_id, e.normalized_unit);
  }
  const mismatch = mergeUnitMismatch(
    rows.map((r) => ({
      name: r.name,
      unit: r.default_unit ?? latestUnit.get(r.id) ?? null,
    }))
  );
  if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 });
  const aliases = rows
    .filter((r) => r.id !== survivor && r.name?.trim())
    .map((r) => ({
      alias_key: aliasKeyFor(r.name),
      alias_name: r.name.trim(),
    }));
  const { data, error } = await supabase.rpc("ingredient_merge", {
    p_company_id: companyId,
    p_survivor_id: survivor,
    p_loser_ids: losers,
    p_chosen_cost_entry_id: chosen,
    p_aliases: aliases,
    p_suggestion_id: suggestion,
  });
  if (error)
    return failureResponse(
      error,
      "No pude unir los ingredientes.",
      "ingredient-merge"
    );
  return NextResponse.json({ ok: true, result: data });
}
