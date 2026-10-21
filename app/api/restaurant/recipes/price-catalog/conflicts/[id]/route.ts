// POST /api/restaurant/recipes/price-catalog/conflicts/:id
// Body: { choice: "catalog" | <candidate index> | "none" }
// "none" = Ninguna (dejar Pendiente): no price for that ingredient.
//
// Records which of two costs a person chose for an ingredient. Company
// and user come from auth, never from the request.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook";
import {
  NO_COST_CHOICE,
  resolveCostConflict,
  type ConflictChoice,
} from "@/lib/restaurant/price-catalog/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  const actor = await resolveActor(auth.supabase, auth.userId, {
    companyId: auth.companyId,
  });
  const denied = requireCapability(actor, "prices.edit");
  if (denied) return denied;

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
  if (
    choice !== "catalog" &&
    choice !== NO_COST_CHOICE &&
    !Number.isInteger(choice)
  ) {
    return NextResponse.json(
      {
        error:
          "Elige el costo de la lista, uno de las recetas o «Ninguna (dejar Pendiente)».",
      },
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
      choice: choice as ConflictChoice,
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
