import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  RESET_FAILED_ERROR_ES,
  RESET_FORBIDDEN_ERROR_ES,
  RESET_PARTIAL_ERROR_ES,
  resetCompanyCostData,
  resetConfirmErrorEs,
  resetConfirmationAccepted,
} from "@/lib/restaurant/cost-workbook";
import {
  loadCompanyMembershipRole,
  loadCompanyName,
} from "@/lib/restaurant/cost-workbook/reset-auth";
import { canManageCompanyCostReset } from "@/lib/restaurant/cost-workbook/reset";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
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
    console.error("[costs/reset] role", message);
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

  let body: { confirm_name?: unknown; location_id?: unknown } = {};
  try {
    body = (await req.json()) as {
      confirm_name?: unknown;
      location_id?: unknown;
    };
  } catch {
    body = {};
  }

  // The reset is company-wide: no restaurant has to be picked. The typed
  // confirmation (company name, or every restaurant's name) is the guard.
  const requestedLocationId =
    typeof body.location_id === "string" ? body.location_id : null;
  const restaurantContext = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    requestedLocationId
  );

  let companyName: string | null = null;
  try {
    companyName = await loadCompanyName(auth.supabase, auth.companyId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    console.error("[costs/reset] company name", message);
  }

  const confirmTarget = {
    companyName,
    restaurantNames: restaurantContext.locations.map((row) => row.name),
  };
  const typed = typeof body.confirm_name === "string" ? body.confirm_name : "";
  if (!resetConfirmationAccepted(typed, confirmTarget)) {
    return NextResponse.json(
      {
        error: resetConfirmErrorEs(confirmTarget),
        code: "confirm_name",
      },
      { status: 400 }
    );
  }

  try {
    const summary = await resetCompanyCostData(
      createSupabaseCostWorkbookRepo(auth.supabase),
      auth.companyId
    );
    if (!summary.ok) {
      return NextResponse.json(
        {
          reset: false,
          ok: false,
          error: RESET_PARTIAL_ERROR_ES,
          summary,
          steps: summary.steps,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      reset: true,
      ok: true,
      summary,
      steps: summary.steps,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error";
    console.error("[costs/reset]", message);
    return NextResponse.json({ error: RESET_FAILED_ERROR_ES }, { status: 500 });
  }
}
