// POST /api/restaurant/item-groups/suggest
//   { scope, items: [{ ref, name, category? }], taken_names?: string[] }
//
// R1-15g (F4): Milton's AI group suggestions for items the name/category
// heuristics could not place. Only names and categories are accepted (and
// sent on); company and user come from auth. Returns clusters to STORE as
// suggestions; nothing is written here.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { actorCanSubmitForApproval } from "@/lib/restaurant/recipe-costing/approval";
import { loadRecipeActor } from "@/lib/restaurant/recipe-costing/actor-server";
import { suggestGroupsWithAi } from "@/lib/ai/group-suggestions";
import { MAX_AI_ITEMS } from "@/lib/restaurant/groups/ai-clusters";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = new Set(["product", "preparation", "ingredient"]);

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
  const scope = body.scope;
  if (typeof scope !== "string" || !SCOPES.has(scope)) {
    return NextResponse.json(
      { error: "Tipo de grupo no válido." },
      { status: 400 }
    );
  }
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length > MAX_AI_ITEMS * 2) {
    return NextResponse.json(
      { error: "Demasiados elementos." },
      { status: 400 }
    );
  }
  const items = rawItems
    .map((i) => i as Record<string, unknown>)
    .filter(
      (i) =>
        typeof i.ref === "string" &&
        i.ref.length <= 200 &&
        typeof i.name === "string" &&
        i.name.length <= 200
    )
    .map((i) => ({
      ref: i.ref as string,
      name: i.name as string,
      category:
        typeof i.category === "string" ? i.category.slice(0, 100) : null,
    }));
  const taken = (Array.isArray(body.taken_names) ? body.taken_names : [])
    .filter((n): n is string => typeof n === "string")
    .slice(0, 500);

  const actor = await loadRecipeActor(
    auth.supabase,
    auth.companyId,
    auth.userId
  );
  if (!actorCanSubmitForApproval(actor)) {
    return NextResponse.json(
      { error: "Tu rol no puede cambiar las agrupaciones." },
      { status: 403 }
    );
  }
  try {
    const result = await suggestGroupsWithAi({
      scope: scope as "product" | "preparation" | "ingredient",
      items,
      takenNames: taken,
    });
    if (!result.ok)
      return NextResponse.json({ unavailable: true, clusters: [] });
    return NextResponse.json({ clusters: result.clusters });
  } catch (err) {
    console.error("[item-groups/suggest]", err);
    return NextResponse.json(
      {
        error: "Milton no pudo sugerir grupos ahora. Inténtalo en un momento.",
      },
      { status: 502 }
    );
  }
}
