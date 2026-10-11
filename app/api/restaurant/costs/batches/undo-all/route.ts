import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  RESET_FORBIDDEN_ERROR_ES,
  UNDO_ALL_FAILED_ERROR_ES,
  undoAllCostImportBatches,
  undoFailureMessageEs,
} from "@/lib/restaurant/cost-workbook";
import { loadCompanyMembershipRole } from "@/lib/restaurant/cost-workbook/reset-auth";
import { canManageCompanyCostReset } from "@/lib/restaurant/cost-workbook/reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let membership;
  try {
    membership = await loadCompanyMembershipRole(
      auth.supabase,
      auth.companyId,
      auth.userId
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    console.error("[costs/batches/undo-all] role", message);
    return NextResponse.json(
      { error: RESET_FORBIDDEN_ERROR_ES, code: "forbidden" },
      { status: 403 }
    );
  }
  if (!canManageCompanyCostReset(membership)) {
    return NextResponse.json(
      { error: RESET_FORBIDDEN_ERROR_ES, code: "forbidden" },
      { status: 403 }
    );
  }

  try {
    const result = await undoAllCostImportBatches(
      createSupabaseCostWorkbookRepo(auth.supabase),
      auth.companyId
    );
    if (!result.ok) {
      return NextResponse.json(
        {
          error: undoFailureMessageEs(result.reason, result.failed_filename),
          undone: result.undone,
          skipped: result.skipped,
          failed_filename: result.failed_filename,
        },
        { status: 400 }
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    console.error("[costs/batches/undo-all]", message);
    return NextResponse.json(
      { error: UNDO_ALL_FAILED_ERROR_ES },
      { status: 500 }
    );
  }
}
