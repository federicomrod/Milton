import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  undoCostImportBatch,
} from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  try {
    const result = await undoCostImportBatch(
      createSupabaseCostWorkbookRepo(auth.supabase),
      auth.companyId,
      id
    );
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    return NextResponse.json({
      undone: true,
      deleted_cost_entries: result.deleted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/batches/undo]", message);
    return NextResponse.json(
      { error: "Undo failed", details: message },
      { status: 500 }
    );
  }
}
