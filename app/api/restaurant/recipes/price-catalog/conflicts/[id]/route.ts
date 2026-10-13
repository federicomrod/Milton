// POST /api/restaurant/recipes/price-catalog/conflicts/:id
// Body: { choice: "catalog" | <candidate index> }
//
// Records which of two costs a person chose for an ingredient. Company
// and user come from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook";
import { resolveCostConflict } from "@/lib/restaurant/price-catalog/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
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
  const choice = body.choice;
  if (choice !== "catalog" && !Number.isInteger(choice)) {
    return NextResponse.json(
      { error: "Elige el costo de la lista o uno de las recetas." },
      { status: 400 }
    );
  }
  try {
    const repo = createSupabaseCostWorkbookRepo(auth.supabase);
    const currency =
      (await resolveCompanyCurrency(auth.supabase, auth.companyId)) || "USD";
    const result = await resolveCostConflict({
      repo,
      companyId: auth.companyId,
      userId: auth.userId,
      currency,
      reviewId: id,
      choice: choice as "catalog" | number,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[recipes/price-catalog/conflicts]", err);
    return NextResponse.json(
      { error: "No pude guardar tu decisión." },
      { status: 500 }
    );
  }
}
