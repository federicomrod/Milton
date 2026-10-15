// POST /api/restaurant/ingredients/archive   { ids: uuid[], archived: boolean }
//
// R1-15i: soft-hide ingredients no active recipe uses (archived_at, 050), or
// restore them. Never a delete. The usage is re-checked HERE, from the
// recipes: an ingredient that is in use is refused, whatever the screen said.
// Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { loadIngredientUsage } from "@/lib/restaurant/ingredient-usage-server";
import { actionableError } from "@/lib/restaurant/actionable-error";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_IDS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  let body: { ids?: unknown; archived?: unknown };
  try {
    body = (await req.json()) as typeof body;
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
  if (ids.length === 0 || ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Elige entre 1 y ${MAX_IDS} ingredientes.` },
      { status: 400 }
    );
  }
  const archive = body.archived !== false;
  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  if (!actorCanSubmitForApproval(actor)) {
    return NextResponse.json(
      { error: "Tu rol no puede archivar ingredientes." },
      { status: 403 }
    );
  }

  let skipped: string[] = [];
  let target = ids;
  if (archive) {
    const usage = await loadIngredientUsage(auth.supabase, auth.companyId);
    // Usage unknown (recipes unreadable): archive nothing rather than guess.
    if (!usage.ok) {
      return NextResponse.json(
        {
          error:
            "No pude leer las recetas para comprobar el uso. Inténtalo de nuevo.",
        },
        { status: 503 }
      );
    }
    skipped = ids.filter((id) => usage.inUse.has(id));
    target = ids.filter((id) => !usage.inUse.has(id));
  }
  if (target.length === 0) {
    return NextResponse.json({ changed: 0, skipped });
  }
  const { data, error } = await auth.supabase
    .from("ingredients")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("company_id", auth.companyId)
    .in("id", target)
    .select("id");
  if (error) {
    // 42703 = the column does not exist yet (migration 050 not applied).
    if (error.code === "42703" || /archived_at/.test(error.message)) {
      return NextResponse.json(
        {
          unavailable: true,
          error:
            "Para archivar falta aplicar la migración 050 en este ambiente.",
        },
        { status: 409 }
      );
    }
    const failure = actionableError(
      error,
      "No pude archivar los ingredientes.",
      "ingredients-archive"
    );
    return NextResponse.json(
      { error: failure.message, ref: failure.ref },
      { status: failure.status }
    );
  }
  return NextResponse.json({ changed: (data ?? []).length, skipped });
}
