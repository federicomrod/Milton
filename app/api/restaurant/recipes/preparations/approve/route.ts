// POST /api/restaurant/recipes/preparations/approve
// Body: { component_id, confirmed_how? }
//
// Approves a preparation's in-review version once its checklist passes, with
// the same roles as a dish: owner or admin; Milton staff only with a
// recorded client confirmation. Company and user come from auth.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { actorCanApprove } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { approvePreparation } from "@/lib/restaurant/recipe-costing/editor-service";
import { createSupabaseEditorStore } from "@/lib/restaurant/recipe-costing/editor-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "El cuerpo tiene que ser JSON." },
      { status: 400 }
    );
  }
  const componentId =
    typeof body.component_id === "string" ? body.component_id.trim() : "";
  if (!componentId) {
    return NextResponse.json(
      { error: "Indica la preparación." },
      { status: 400 }
    );
  }

  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  const allowed = actorCanApprove(actor, {
    confirmed_by: auth.userId,
    confirmed_at: new Date().toISOString(),
    confirmed_how:
      typeof body.confirmed_how === "string" && body.confirmed_how.trim()
        ? body.confirmed_how.trim()
        : undefined,
  });
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error }, { status: 403 });
  }

  try {
    const result = await approvePreparation({
      store: createSupabaseEditorStore(auth.supabase),
      companyId: auth.companyId,
      odooProductId: 0,
      locationId: null,
      componentId,
      userId: auth.userId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    return NextResponse.json({
      ...result.state,
      refreshed_dishes: result.refreshed_dishes,
    });
  } catch (err) {
    console.error("[recipes/preparations/approve]", err);
    return NextResponse.json(
      { error: "No pude aprobar la preparación." },
      { status: 500 }
    );
  }
}
