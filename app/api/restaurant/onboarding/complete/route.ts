// app/api/restaurant/onboarding/complete/route.ts
//
// POST /api/restaurant/onboarding/complete
//
// Finishes restaurant onboarding for the AUTHENTICATED user's company —
// company_id is never accepted from the request body, only resolved
// server-side via authAndCompany(), same pattern as every other restaurant
// route. Writes go through the normal RLS-backed client (no service role).
//
// What this route persists (migration 014 — see the architecture audit
// for why these live where they do, not all on `companies`):
//   - the company's first restaurant_brands row, if none exists yet,
//     including its declared concept_type
//   - the company's first restaurant_locations row, if none exists yet
//     (country + a currency derived from country; name reuses the
//     restaurant's own name since this is its one known/flagship location),
//     including its declared primary_pos
//   - companies.location_count_range, companies.priorities,
//     companies.onboarding_status = 'completed'
//   - companies.preferred_language (migration 016 — Milton Language
//     Foundation v1; company-level, applies to every restaurant under it)
//
// Every submitted value is validated server-side against the fixed option
// lists in lib/restaurant/onboarding-copy.ts before being written — the
// columns themselves carry no CHECK constraint (deliberately additive-only
// migration), so this route is the only guard against a malformed payload.
//
// Idempotent AND retry-safe: brand/location existence is checked first;
// if a row already exists (e.g. a retried submit after a partial
// failure), it is UPDATEd with the current submission's concept_type /
// primary_pos rather than left stale — never a second, duplicate row.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  currencyForCountry,
  normalizeConceptType,
  normalizeLocationCountBucket,
  normalizePosSystemChoice,
  normalizePriorities,
} from "@/lib/restaurant/onboarding-copy";
import {
  defaultLanguageForCountry,
  normalizePreferredLanguage,
} from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RequestBody {
  country?: string | null;
  conceptType?: unknown;
  preferredLanguage?: unknown;
  locationCount?: unknown;
  posSystem?: unknown;
  priorities?: unknown;
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
      // Empty/invalid body is fine — every field below normalizes to a
      // safe default (null / empty array) when absent or malformed.
    }
    const country =
      typeof body.country === "string" && body.country.trim()
        ? body.country.trim()
        : null;
    const conceptType = normalizeConceptType(body.conceptType);
    const locationCount = normalizeLocationCountBucket(body.locationCount);
    const posSystem = normalizePosSystemChoice(body.posSystem);
    const priorities = normalizePriorities(body.priorities);
    // Server-side default mirrors the wizard's own smart default so a
    // missing/malformed value never silently falls back to English for a
    // Spanish-default country — see lib/restaurant/language.ts.
    const preferredLanguage =
      normalizePreferredLanguage(body.preferredLanguage) ??
      defaultLanguageForCountry(country);

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
      // Retry-safe: refresh the declared concept type on the existing
      // brand rather than leaving it stale from a prior partial attempt.
      const { error: brandUpdateError } = await supabase
        .from("restaurant_brands")
        .update({ concept_type: conceptType })
        .eq("id", brandId);
      if (brandUpdateError) {
        console.error(
          "[onboarding/complete] restaurant_brands update failed:",
          brandUpdateError.message
        );
      }
    } else {
      const { data: newBrand, error: brandInsertError } = await supabase
        .from("restaurant_brands")
        .insert({
          company_id: companyId,
          name: restaurantName,
          concept_type: conceptType,
        })
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

    if (existingLocation?.id) {
      // Retry-safe: refresh the declared POS system on the existing
      // location rather than leaving it stale from a prior partial attempt.
      const { error: locationUpdateError } = await supabase
        .from("restaurant_locations")
        .update({ primary_pos: posSystem })
        .eq("id", existingLocation.id);
      if (locationUpdateError) {
        console.error(
          "[onboarding/complete] restaurant_locations update failed:",
          locationUpdateError.message
        );
      }
    } else if (brandId) {
      const { error: locationInsertError } = await supabase
        .from("restaurant_locations")
        .insert({
          brand_id: brandId,
          company_id: companyId,
          name: restaurantName,
          country: country,
          currency: country ? currencyForCountry(country) : "USD",
          primary_pos: posSystem,
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

    // --- Company-level profile fields + mark onboarding complete -----------
    // Best-effort; never blocks the response. Always reflects the current
    // submission — location_count_range/priorities are a full replace,
    // not a merge, matching how the wizard sends its current state each
    // time (never a partial diff).
    const { error: statusError } = await supabase
      .from("companies")
      .update({
        onboarding_status: "completed",
        location_count_range: locationCount,
        priorities,
        preferred_language: preferredLanguage,
      })
      .eq("id", companyId);
    if (statusError) {
      console.error(
        "[onboarding/complete] companies profile update failed:",
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
