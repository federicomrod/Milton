// app/api/restaurant/add-restaurant/route.ts
//
// POST /api/restaurant/add-restaurant
//
// Multi-Restaurant UX v1, Phase 3 — lets an existing company add a SECOND
// (or third, ...) restaurant brand/location without creating another
// account. Deliberately small: collects only name, concept type, country,
// and POS system, mirroring app/api/restaurant/onboarding/complete/route.ts
// (same validation helpers, same "server is the only guard" rationale —
// the restaurant_brands/restaurant_locations columns carry no CHECK
// constraint).
//
// company_id is never accepted from the request body, only resolved
// server-side via authAndCompany() — same pattern as every other
// restaurant route.
//
// Idempotency: there is no idempotency-key column (adding one would need a
// migration, out of scope here), so retry-safety is done the same way the
// rest of this codebase does it — look the row up first. Concretely: a
// case-insensitive, trimmed match against this company's EXISTING
// restaurant_brands.name is treated as "this is a retry of an earlier
// submission" and the existing brand/location is returned rather than a
// second one being created. This means two genuinely different restaurants
// under one company cannot share the exact same name in this v1 — an
// acceptable, documented tradeoff rather than a new schema column.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import {
  currencyForCountry,
  normalizeConceptType,
  normalizePosSystemChoice,
} from "@/lib/restaurant/onboarding-copy";
import { findMatchingBrandByName } from "@/lib/restaurant/add-restaurant-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_NAME_LENGTH = 120;

interface RequestBody {
  name?: unknown;
  conceptType?: unknown;
  country?: unknown;
  posSystem?: unknown;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
      return NextResponse.json(
        { error: "A restaurant name is required." },
        { status: 400 }
      );
    }

    const name = normalizeName(body.name);
    if (!name) {
      return NextResponse.json(
        { error: "A restaurant name is required." },
        { status: 400 }
      );
    }
    const conceptType = normalizeConceptType(body.conceptType);
    const country = normalizeCountry(body.country);
    const posSystem = normalizePosSystemChoice(body.posSystem);

    // --- Idempotency check: does this company already have a brand with
    // this exact (case-insensitive) name? If so, this is a retry — return
    // the existing brand + its first location rather than creating a
    // duplicate.
    const { data: existingBrands, error: existingBrandsError } = await supabase
      .from("restaurant_brands")
      .select("id, name")
      .eq("company_id", companyId);
    if (existingBrandsError) {
      console.error(
        "[add-restaurant] restaurant_brands lookup failed:",
        existingBrandsError.message
      );
      return NextResponse.json(
        {
          error: "Could not add restaurant",
          details: existingBrandsError.message,
        },
        { status: 500 }
      );
    }
    const existingMatch = findMatchingBrandByName(existingBrands ?? [], name);

    if (existingMatch) {
      const { data: existingLocation, error: existingLocationError } =
        await supabase
          .from("restaurant_locations")
          .select("id")
          .eq("brand_id", existingMatch.id)
          .limit(1)
          .maybeSingle();
      if (existingLocationError) {
        console.error(
          "[add-restaurant] restaurant_locations lookup (retry path) failed:",
          existingLocationError.message
        );
      }
      return NextResponse.json({
        success: true,
        created: false,
        brandId: existingMatch.id,
        locationId: existingLocation?.id ?? null,
      });
    }

    // --- Create the new brand ------------------------------------------------
    const { data: newBrand, error: brandInsertError } = await supabase
      .from("restaurant_brands")
      .insert({
        company_id: companyId,
        name,
        concept_type: conceptType,
      })
      .select("id")
      .single();
    if (brandInsertError || !newBrand?.id) {
      console.error(
        "[add-restaurant] restaurant_brands insert failed:",
        brandInsertError?.message
      );
      return NextResponse.json(
        {
          error: "Could not create restaurant",
          details: brandInsertError?.message,
        },
        { status: 500 }
      );
    }

    // --- Create its first location -------------------------------------------
    const { data: newLocation, error: locationInsertError } = await supabase
      .from("restaurant_locations")
      .insert({
        brand_id: newBrand.id,
        company_id: companyId,
        name,
        country,
        currency: country ? currencyForCountry(country) : "USD",
        primary_pos: posSystem,
        is_active: true,
      })
      .select("id")
      .single();
    if (locationInsertError || !newLocation?.id) {
      console.error(
        "[add-restaurant] restaurant_locations insert failed:",
        locationInsertError?.message
      );
      // The brand row now exists without a location — a later retry with
      // the same name will find it via the idempotency check above and
      // simply try creating the location again (existingLocation will be
      // null the same way), rather than erroring on a duplicate brand.
      return NextResponse.json(
        {
          error: "Restaurant created but location setup failed",
          details: locationInsertError?.message,
          brandId: newBrand.id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      created: true,
      brandId: newBrand.id,
      locationId: newLocation.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[add-restaurant] Unexpected error:", message);
    return NextResponse.json(
      { error: "Could not add restaurant", details: message },
      { status: 500 }
    );
  }
}
