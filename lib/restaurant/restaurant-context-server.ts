// lib/restaurant/restaurant-context-server.ts
//
// Resolves the "which restaurant is selected" context shared by the
// cockpit page, the restaurant-shell switcher, and the briefing route
// (Multi-Restaurant UX v1).
//
// SECURITY (Phase 6): the returned `locations` list is always scoped to
// the caller's own company_id. A requested location_id is only ever
// accepted if it appears in that same company-scoped list — an arbitrary
// UUID belonging to another company (or a garbage string) simply won't be
// found, and silently falls back to consolidated (`selected: null`) rather
// than erroring or leaking whether the id exists elsewhere. This is the
// single place that validation happens; every caller below goes through it
// rather than trusting a client-supplied id directly.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";

export interface RestaurantLocationOption {
  id: string;
  name: string;
  brand_id: string | null;
}

export interface SelectedRestaurant {
  locationId: string;
  brandId: string | null;
}

export interface RestaurantContext {
  /** Every location belonging to the caller's company — for the switcher UI. */
  locations: RestaurantLocationOption[];
  /** null = consolidated/"All Restaurants". Never trust a caller-supplied
   *  id without going through this resolver first. */
  selected: SelectedRestaurant | null;
}

/**
 * Pure security core of the resolver — no I/O, directly unit-testable.
 * A requested id is only ever trusted when it appears in `locations`
 * (already scoped to the caller's own company by the caller). Anything
 * else — another company's location id, a deleted id, a garbage string —
 * silently resolves to null (consolidated) rather than throwing or
 * revealing whether the id exists elsewhere.
 */
export function resolveSelectedLocation(
  locations: RestaurantLocationOption[],
  requestedLocationId: string | null | undefined
): SelectedRestaurant | null {
  if (!requestedLocationId) return null;
  const match = locations.find((l) => l.id === requestedLocationId);
  return match ? { locationId: match.id, brandId: match.brand_id } : null;
}

/**
 * @param requestedLocationId the raw `?location=` value, or null/undefined
 *   for consolidated. Validated against `companyId`'s own locations before
 *   being trusted.
 */
export async function resolveRestaurantContext(
  supabase: SupabaseClient,
  companyId: string,
  requestedLocationId: string | null | undefined
): Promise<RestaurantContext> {
  const { data, error } = await supabase
    .from("restaurant_locations")
    .select("id, name, brand_id")
    .eq("company_id", companyId)
    .order("name", { ascending: true });

  if (error) {
    console.error(
      "[restaurant-context] locations lookup failed:",
      error.message
    );
  }
  const locations = (data ?? []) as RestaurantLocationOption[];
  const selected = resolveSelectedLocation(locations, requestedLocationId);

  return { locations, selected };
}

/**
 * Convenience wrapper for the shell layouts, which only need the list of
 * the current user's company's locations (not a specific selection) to
 * render the restaurant switcher. Returns an empty list for an
 * unauthenticated user or one with no resolved company — the switcher
 * then just shows "All Restaurants" with nothing to switch to.
 */
export async function listRestaurantLocationsForCurrentUser(
  supabase: SupabaseClient
): Promise<RestaurantLocationOption[]> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user?.id) return [];
  const companyId = await resolveCompanyIdForUser(supabase, userData.user.id);
  if (!companyId) return [];
  const { locations } = await resolveRestaurantContext(
    supabase,
    companyId,
    null
  );
  return locations;
}
