import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  approveReviewItem,
  createSupabaseCostWorkbookRepo,
  skipReviewItem,
} from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: {
    action?: string;
    ingredient_name?: string;
    unit?: string;
    quantity?: number;
    total_cost?: number;
    cost_date?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const repo = createSupabaseCostWorkbookRepo(auth.supabase);
  try {
    if (body.action === "skip") {
      const result = await skipReviewItem(repo, auth.companyId, id);
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true, status: "skipped" });
    }
    if (body.action === "approve") {
      const currency = await resolveCompanyCurrency(
        auth.supabase,
        auth.companyId
      );
      const result = await approveReviewItem(
        repo,
        auth.companyId,
        id,
        currency,
        {
          ingredient_name: body.ingredient_name,
          unit: body.unit,
          quantity: body.quantity,
          total_cost: body.total_cost,
          cost_date: body.cost_date,
        }
      );
      if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
      }
      return NextResponse.json({ ok: true, status: "approved" });
    }
    return NextResponse.json(
      { error: "action must be approve or skip" },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/review POST]", message);
    return NextResponse.json(
      { error: "Review update failed", details: message },
      { status: 500 }
    );
  }
}
