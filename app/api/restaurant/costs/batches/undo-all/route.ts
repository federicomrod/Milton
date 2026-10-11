import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  undoAllCostImportBatches,
} from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  try {
    const result = await undoAllCostImportBatches(
      createSupabaseCostWorkbookRepo(auth.supabase),
      auth.companyId
    );
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.reason ?? "Undo all failed",
          undone: result.undone,
          skipped: result.skipped,
          failed_filename: result.failed_filename,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/batches/undo-all]", message);
    return NextResponse.json(
      { error: "Undo all failed", details: message },
      { status: 500 }
    );
  }
}
