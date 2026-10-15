// GET /api/restaurant/recipes/price-catalog/conflicts
//
// Open "two costs for the same ingredient" decisions for the company.
// Company comes from auth, never from the request.

import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook";
import { COST_CONFLICT_KIND } from "@/lib/restaurant/price-catalog/apply";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;
  try {
    const repo = createSupabaseCostWorkbookRepo(auth.supabase);
    const items = await repo.listReviewItems(auth.companyId, {
      status: "pending",
    });
    const conflicts = items
      .filter((item) => item.raw_values.kind === COST_CONFLICT_KIND)
      .map((item) => ({
        id: item.id,
        name: item.raw_values.name,
        catalog: item.raw_values.catalog,
        candidates: item.raw_values.candidates,
      }));
    return NextResponse.json({ conflicts });
  } catch (err) {
    console.error("[recipes/price-catalog/conflicts]", err);
    return NextResponse.json(
      { error: "No pude leer las decisiones pendientes." },
      { status: 500 }
    );
  }
}
