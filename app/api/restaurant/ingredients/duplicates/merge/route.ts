// POST /api/restaurant/ingredients/duplicates/merge
//   { survivor_id, loser_ids: [uuid], chosen_cost_entry_id?, suggestion_id? }
//
// R1-15k: Unir. One transaction in the database (ingredient_merge, 051):
// repoints every recipe line, price and invoice match, remembers the losers'
// names as aliases (the importer reads them), archives the losers, writes the
// undo record. The aliases are made here from the names in the database, never
// from the request.

import { NextRequest, NextResponse } from "next/server";
import { aliasKeyFor } from "@/lib/restaurant/cost-workbook/repo";
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
  // The losers' names, from the database.
  const names = await supabase
    .from("ingredients")
    .select("id, name")
    .eq("company_id", companyId)
    .in("id", losers);
  if (names.error)
    return failureResponse(
      names.error,
      "No pude leer los ingredientes.",
      "ingredient-merge"
    );
  const aliases = ((names.data ?? []) as Array<{ id: string; name: string }>)
    .filter((r) => r.name?.trim())
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
