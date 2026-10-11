import { NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  listCostImportHistory,
} from "@/lib/restaurant/cost-workbook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  try {
    const batches = await listCostImportHistory(
      createSupabaseCostWorkbookRepo(auth.supabase),
      auth.companyId
    );
    return NextResponse.json({ batches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/batches GET]", message);
    return NextResponse.json(
      { error: "Could not load import history", details: message },
      { status: 500 }
    );
  }
}
