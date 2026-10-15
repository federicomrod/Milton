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
import { errorMentionsColumn } from "@/lib/restaurant/missing-schema-column";
import {
  getCachedAuthUser,
  getCachedCompanyId,
} from "@/lib/restaurant/auth-user";

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

// Before migration 055 `archived_at` does not exist: remember that for a
// minute, so the first select is not repeated and failed on every request.
let archivedColumnMissingUntil = 0;

/**
 * The company's restaurants, archived ones included (`archived_at` is null
 * before 055 or when active). Never throws.
 */
export async function listAllCompanyRestaurants(
  supabase: SupabaseClient,
  companyId: string
): Promise<{
  locations: Array<RestaurantLocationOption & { archived_at: string | null }>;
  archiveAvailable: boolean;
}> {
  type Row = RestaurantLocationOption & { archived_at?: string | null };
  const read = (columns: string) =>
    supabase
      .from("restaurant_locations")
      .select(columns)
      .eq("company_id", companyId)
      .order("name", { ascending: true });
  let archiveAvailable = Date.now() >= archivedColumnMissingUntil;
  let res = archiveAvailable
    ? await read("id, name, brand_id, archived_at")
    : await read("id, name, brand_id");
  if (
    res.error &&
    archiveAvailable &&
    errorMentionsColumn(res.error, "archived_at")
  ) {
    archiveAvailable = false;
    archivedColumnMissingUntil = Date.now() + 60_000;
    res = await read("id, name, brand_id");
  }
  if (res.error) {
    console.error(
      "[restaurant-context] locations lookup failed:",
      res.error.message
    );
  }
  const rows = ((res.data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    name: r.name,
    brand_id: r.brand_id,
    archived_at: r.archived_at ?? null,
  }));
  return { locations: rows, archiveAvailable };
}

/**
 * @param requestedLocationId the raw `?location=` value, or null/undefined
 *   for consolidated. Validated against `companyId`'s own locations before
 *   being trusted. Archived restaurants are not offered (switcher) and an
 *   archived id falls back to consolidated.
 */
export async function resolveRestaurantContext(
  supabase: SupabaseClient,
  companyId: string,
  requestedLocationId: string | null | undefined
): Promise<RestaurantContext> {
  const all = await listAllCompanyRestaurants(supabase, companyId);
  const locations: RestaurantLocationOption[] = all.locations
    .filter((l) => !l.archived_at)
    .map((l) => ({ id: l.id, name: l.name, brand_id: l.brand_id }));
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
  const user = await getCachedAuthUser();
  if (!user?.id) return [];
  const companyId = await getCachedCompanyId(user.id);
  if (!companyId) return [];
  const { locations } = await resolveRestaurantContext(
    supabase,
    companyId,
    null
  );
  return locations;
}
