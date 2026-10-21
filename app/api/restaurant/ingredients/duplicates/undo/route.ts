// POST /api/restaurant/ingredients/duplicates/undo   { merge_id }
// R1-15k: Deshacer a merge (ingredient_merge_undo, 051): lines, prices,
// aliases and archive state go back exactly as the undo record says.

import { requireCapability } from "@/lib/auth/permissions";
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
  const denied = requireCapability(g.actor, "ingredients.manage", {
    message: "Tu rol no puede unir ni descartar ingredientes.",
  });
  if (denied) return denied;
  let body: { merge_id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  if (typeof body.merge_id !== "string" || !UUID.test(body.merge_id)) {
    return NextResponse.json(
      { error: "Falta la unión que se deshace." },
      { status: 400 }
    );
  }
  const { data, error } = await g.auth.supabase.rpc("ingredient_merge_undo", {
    p_company_id: g.auth.companyId,
    p_merge_id: body.merge_id,
  });
  if (error)
    return failureResponse(
      error,
      "No pude deshacer la unión.",
      "ingredient-merge-undo"
    );
  return NextResponse.json({ ok: true, result: data });
}
