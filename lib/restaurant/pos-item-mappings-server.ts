// lib/restaurant/pos-item-mappings-server.ts
//
// Shared read/write helpers for pos_item_mappings, used by both
// app/api/restaurant/menu-items/route.ts (create-mapping-from-unmatched)
// and app/api/restaurant/pos-mappings/route.ts (direct mapping CRUD).
//
// Location-aware (migration 015): a mapping is either scoped to one
// restaurant_location (location_id NOT NULL) or company-wide/legacy
// (location_id NULL). The two are enforced as separate uniqueness groups
// by two partial unique indexes — see the migration's own comments for
// why a single composite UNIQUE(company_id, location_id, raw_pos_item_name)
// would NOT be safe (NULL is never "equal" to NULL in a plain SQL UNIQUE
// constraint, so it wouldn't stop duplicate ambiguous legacy rows).
//
// Because the uniqueness is enforced via PARTIAL indexes, Supabase/
// PostgREST's `.upsert(..., { onConflict })` cannot target them directly
// (ON CONFLICT inference requires the query to repeat the index's WHERE
// predicate, which PostgREST has no way to pass through). So writes here
// do an explicit lookup-then-insert-or-update instead of relying on
// upsert — the same pattern already used in
// app/api/restaurant/onboarding/complete/route.ts for retry-safe writes.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UpsertMappingParams {
  companyId: string;
  /** null = company-wide/legacy mapping. */
  locationId: string | null;
  rawPosItemName: string;
  menuItemId: string;
  matchType?: "manual" | "suggested" | "auto";
}

export interface MappingWriteResult {
  error: string | null;
}

export async function upsertPosItemMapping(
  supabase: SupabaseClient,
  params: UpsertMappingParams
): Promise<MappingWriteResult> {
  const { companyId, locationId, rawPosItemName, menuItemId } = params;
  const matchType = params.matchType ?? "manual";

  let existingQuery = supabase
    .from("pos_item_mappings")
    .select("id")
    .eq("company_id", companyId)
    .eq("raw_pos_item_name", rawPosItemName);
  existingQuery = locationId
    ? existingQuery.eq("location_id", locationId)
    : existingQuery.is("location_id", null);

  const { data: existing, error: lookupError } =
    await existingQuery.maybeSingle();
  if (lookupError) return { error: lookupError.message };

  if (existing?.id) {
    const { error } = await supabase
      .from("pos_item_mappings")
      .update({ menu_item_id: menuItemId, match_type: matchType })
      .eq("id", existing.id);
    return { error: error?.message ?? null };
  }

  const { error } = await supabase.from("pos_item_mappings").insert({
    company_id: companyId,
    location_id: locationId,
    raw_pos_item_name: rawPosItemName,
    menu_item_id: menuItemId,
    match_type: matchType,
  });
  return { error: error?.message ?? null };
}

export interface DeleteMappingParams {
  companyId: string;
  /** null = delete the company-wide/legacy mapping only. */
  locationId: string | null;
  rawPosItemName: string;
}

export async function deletePosItemMapping(
  supabase: SupabaseClient,
  params: DeleteMappingParams
): Promise<MappingWriteResult> {
  let query = supabase
    .from("pos_item_mappings")
    .delete()
    .eq("company_id", params.companyId)
    .eq("raw_pos_item_name", params.rawPosItemName);
  query = params.locationId
    ? query.eq("location_id", params.locationId)
    : query.is("location_id", null);

  const { error } = await query;
  return { error: error?.message ?? null };
}
