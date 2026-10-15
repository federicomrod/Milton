// POST /api/restaurant/recipes/preparations/approve
// Body: { component_id, confirmed_how? }
//
// Approves a preparation's in-review version once its checklist passes, with
// the same roles as a dish: owner or admin; Milton staff only with a
// recorded client confirmation. Company and user come from auth.

import { after, NextRequest, NextResponse } from "next/server";
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

  const confirmedHow =
    typeof body.confirmed_how === "string" && body.confirmed_how.trim()
      ? body.confirmed_how.trim()
      : null;
  // R1-13: the role check runs while the preparation is read; nothing is
  // written until it passes.
  const guard = loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  ).then((actor) => {
    const allowed = actorCanApprove(actor, {
      confirmed_by: auth.userId,
      confirmed_at: new Date().toISOString(),
      confirmed_how: confirmedHow ?? undefined,
    });
    return allowed.ok
      ? null
      : { ok: false as const, error: allowed.error, status: 403 };
  });
  guard.catch(() => undefined);

  try {
    const result = await approvePreparation({
      store: createSupabaseEditorStore(auth.supabase),
      companyId: auth.companyId,
      odooProductId: 0,
      locationId: null,
      componentId,
      userId: auth.userId,
      confirmedHow,
      guard,
      // R1-13: answer now; the dishes that use it are re-costed after the
      // response, in bulk.
      deferRefresh: true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status ?? 400 }
      );
    }
    const { recost } = result;
    if (recost) {
      after(async () => {
        try {
          const n = await recost();
          console.info(`[recipes/preparations/approve] re-costed ${n} dishes`);
        } catch (err) {
          console.error("[recipes/preparations/approve recost]", err);
        }
      });
    }
    return NextResponse.json({
      ...result.state,
      refreshed_dishes: result.refreshed_dishes,
      recosting: Boolean(recost),
    });
  } catch (err) {
    console.error("[recipes/preparations/approve]", err);
    return NextResponse.json(
      { error: "No pude aprobar la preparación." },
      { status: 500 }
    );
  }
}
