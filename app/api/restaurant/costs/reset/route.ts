import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  createSupabaseCostWorkbookRepo,
  PICK_RESTAURANT_ERROR_EN,
  PICK_RESTAURANT_ERROR_ES,
  RESET_CONFIRM_FALLBACK,
  resetCompanyCostData,
  resetConfirmationMatches,
  resolveUploadRestaurantScope,
} from "@/lib/restaurant/cost-workbook";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = await authAndCompany();
  if (!auth.ok) return auth.response;

  let body: { confirm_name?: unknown; location_id?: unknown } = {};
  try {
    body = (await req.json()) as {
      confirm_name?: unknown;
      location_id?: unknown;
    };
  } catch {
    body = {};
  }

  const requestedLocationId =
    typeof body.location_id === "string" ? body.location_id : null;
  const restaurantContext = await resolveRestaurantContext(
    auth.supabase,
    auth.companyId,
    requestedLocationId
  );
  const scope = resolveUploadRestaurantScope({
    locations: restaurantContext.locations,
    requestedLocationId,
  });
  if (!scope.ok) {
    return NextResponse.json(
      {
        error: PICK_RESTAURANT_ERROR_ES,
        error_en: PICK_RESTAURANT_ERROR_EN,
        code: scope.code,
      },
      { status: 400 }
    );
  }

  const expectedName = scope.name?.trim() || RESET_CONFIRM_FALLBACK;
  const typed = typeof body.confirm_name === "string" ? body.confirm_name : "";
  if (!resetConfirmationMatches(typed, expectedName)) {
    return NextResponse.json(
      {
        error: "Type the restaurant name to confirm",
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
    return NextResponse.json({
      reset: true,
      restaurant_name: scope.name,
      summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[costs/reset]", message);
    return NextResponse.json(
      { error: "Reset failed", details: message },
      { status: 500 }
    );
  }
}
