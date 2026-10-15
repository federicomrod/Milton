// POST /api/restaurant/ingredients/duplicates/decide
//   { ids: [uuid], action: "skip" | "reject", source?: "name" | "ai", score? }
// R1-15k: «Ahora no» (skip: the suggestion goes to the end of the queue and
// stays pending) and «No son iguales» (reject: every pair of the set is
// never suggested again). One transaction (ingredient_duplicate_decide, 051).

import { NextRequest, NextResponse } from "next/server";
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
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const ids = Array.isArray(body.ids)
    ? [
        ...new Set(
          body.ids.filter(
            (x): x is string => typeof x === "string" && UUID.test(x)
          )
        ),
      ]
    : [];
  const action =
    body.action === "reject"
      ? "reject"
      : body.action === "skip"
        ? "skip"
        : null;
  if (!action || ids.length < 2 || ids.length > 12) {
    return NextResponse.json(
      { error: "Elige entre 2 y 12 ingredientes y una acción." },
      { status: 400 }
    );
  }
  const { data, error } = await g.auth.supabase.rpc(
    "ingredient_duplicate_decide",
    {
      p_company_id: g.auth.companyId,
      p_ingredient_ids: ids,
      p_action: action,
      p_source: body.source === "ai" ? "ai" : "name",
      p_score:
        typeof body.score === "number" && Number.isFinite(body.score)
          ? body.score
          : null,
    }
  );
  if (error)
    return failureResponse(
      error,
      "No pude guardar tu decisión.",
      "ingredient-duplicate-decide"
    );
  return NextResponse.json({ ok: true, result: data });
}
