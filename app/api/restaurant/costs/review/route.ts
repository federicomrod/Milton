import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { createSupabaseCostWorkbookRepo } from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  const batchId = req.nextUrl.searchParams.get("batch_id") ?? undefined;
  const status = req.nextUrl.searchParams.get("status") ?? "pending";

  try {
    const items = await createSupabaseCostWorkbookRepo(
      auth.supabase
    ).listReviewItems(auth.companyId, {
      batchId,
      status:
        status === "approved" || status === "skipped" || status === "pending"
          ? status
          : "pending",
    });
    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/review GET]", message);
    return NextResponse.json(
      { error: "Could not load review items", details: message },
      { status: 500 }
    );
  }
}
