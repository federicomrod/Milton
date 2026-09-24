// app/api/restaurant/onboarding/complete/route.ts
//
// POST /api/restaurant/onboarding/complete
//
// Finishes restaurant onboarding for the AUTHENTICATED user's company —
// company_id is never accepted from the request body, only resolved
// server-side via authAndCompany(), same pattern as every other restaurant
// route. Writes go through the normal RLS-backed client (no service role).
//
// What this route persists (see the onboarding copy/report for why the
// rest — concept type, location-count bucket, POS choice, priorities —
// is NOT durably stored yet: no existing column represents them, and a
// new migration for those was intentionally deferred for review rather
// than written here):
//   - the company's first restaurant_brands row, if none exists yet
//   - the company's first restaurant_locations row, if none exists yet
//     (country + a currency derived from country; name reuses the
//     restaurant's own name since this is its one known/flagship location)
//   - companies.onboarding_status = 'completed'
//
// Idempotent: safe to call more than once (e.g. a retried submit) —
// brand/location creation is skipped if a row already exists for the
// company, matching the task's explicit "do not create fake/duplicate
// location rows" requirement.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { currencyForCountry } from "@/lib/restaurant/onboarding-copy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  country?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    let body: RequestBody = {};
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      // Empty/invalid body is fine — country is the only field this route
      // actually needs; everything else in the wizard's payload is used
      // client-side only for now (see file header).
    }
    const country =
      typeof body.country === "string" && body.country.trim()
        ? body.country.trim()
        : null;

    const { data: companyRow, error: companyError } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    if (companyError) {
      console.error(
        "[onboarding/complete] companies lookup failed:",
        companyError.message
      );
    }
    const restaurantName = companyRow?.name || "Restaurant";

    // --- Brand: create the first one if none exists ------------------------
    let brandId: string | null = null;
    const { data: existingBrand, error: brandLookupError } = await supabase
      .from("restaurant_brands")
      .select("id")
      .eq("company_id", companyId)
      .limit(1)
      .maybeSingle();
    if (brandLookupError) {
      console.error(
        "[onboarding/complete] restaurant_brands lookup failed:",
        brandLookupError.message
      );
    }

    if (existingBrand?.id) {
      brandId = existingBrand.id;
    } else {
      const { data: newBrand, error: brandInsertError } = await supabase
        .from("restaurant_brands")
        .insert({ company_id: companyId, name: restaurantName })
        .select("id")
        .single();
      if (brandInsertError) {
        console.error(
          "[onboarding/complete] restaurant_brands insert failed:",
          brandInsertError.message
        );
      } else {
        brandId = newBrand?.id ?? null;
      }
    }

    // --- Location: create the first one if none exists yet -----------------
    let locationCreated = false;
    const { data: existingLocation, error: locationLookupError } =
      await supabase
        .from("restaurant_locations")
        .select("id")
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle();
    if (locationLookupError) {
      console.error(
        "[onboarding/complete] restaurant_locations lookup failed:",
        locationLookupError.message
      );
    }

    if (!existingLocation && brandId) {
      const { error: locationInsertError } = await supabase
        .from("restaurant_locations")
        .insert({
          brand_id: brandId,
          company_id: companyId,
          name: restaurantName,
          country: country,
          currency: country ? currencyForCountry(country) : "USD",
          is_active: true,
        });
      if (locationInsertError) {
        console.error(
          "[onboarding/complete] restaurant_locations insert failed:",
          locationInsertError.message
        );
      } else {
        locationCreated = true;
      }
    }

    // --- Mark onboarding complete (best-effort; never blocks the response) -
    const { error: statusError } = await supabase
      .from("companies")
      .update({ onboarding_status: "completed" })
      .eq("id", companyId);
    if (statusError) {
      console.error(
        "[onboarding/complete] onboarding_status update failed:",
        statusError.message
      );
    }

    return NextResponse.json({ success: true, locationCreated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[onboarding/complete] Unexpected error:", message);
    return NextResponse.json(
      { error: "Could not finish onboarding", details: message },
      { status: 500 }
    );
  }
}
