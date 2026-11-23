// lib/restaurant/pos-dedup.ts
//
// Shared location-aware deduplication logic for sales uploads.
// Prevents accidentally deleting other locations' sales.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PosSalesItemInsert } from "./pos-import";

export interface DedupResult {
  deletedCount: number;
  error?: {
    message: string;
    code: string;
  };
}

/**
 * Safely delete existing sales rows for replace_existing uploads.
 * 
 * Rules:
 * 1. If location is mapped and location_ids resolved: delete only those location_ids
 * 2. If location not mapped or none resolved:
 *    - If company has >1 location: refuse with error
 *    - If company has exactly 1 location: scope to that location_id
 * 3. Always scoped to: company_id, date range from file
 */
export async function deleteSalesForReplace(
  supabase: SupabaseClient,
  companyId: string,
  inserts: PosSalesItemInsert[],
  mappedLocationIds: Set<string>
): Promise<DedupResult> {
  if (inserts.length === 0) {
    return { deletedCount: 0 };
  }

  // Extract date range
  const dates = inserts.map(r => r.sale_date).filter(Boolean).sort();
  if (dates.length === 0) {
    return { deletedCount: 0 };
  }
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  // Case 1: Location is mapped and IDs resolved
  if (mappedLocationIds.size > 0) {
    const locationIds = Array.from(mappedLocationIds);
    const { error, count } = await supabase
      .from("pos_sales_items")
      .delete({ count: "exact" })
      .eq("company_id", companyId)
      .gte("sale_date", minDate)
      .lte("sale_date", maxDate)
      .in("location_id", locationIds);

    if (error) {
      return {
        deletedCount: 0,
        error: {
          message: "Error al eliminar ventas anteriores",
          code: "delete_failed",
        },
      };
    }

    return { deletedCount: count ?? 0 };
  }

  // Case 2: Location not mapped or none resolved
  // Check if company has multiple locations
  const { data: locations, error: locError } = await supabase
    .from("restaurant_locations")
    .select("id")
    .eq("company_id", companyId);

  if (locError) {
    return {
      deletedCount: 0,
      error: {
        message: "Error al verificar los locales",
        code: "location_check_failed",
      },
    };
  }

  const locationCount = (locations ?? []).length;

  // If company has multiple locations, refuse
  if (locationCount > 1) {
    return {
      deletedCount: 0,
      error: {
        message:
          "No se puede reemplazar ventas sin mapear el local. Tu empresa tiene varios locales. Por favor, mapea la columna de local para evitar borrar ventas de otros locales.",
        code: "multi_location_unmapped",
      },
    };
  }

  // Single location or no locations: scope delete appropriately
  let deleteQuery = supabase
    .from("pos_sales_items")
    .delete({ count: "exact" })
    .eq("company_id", companyId)
    .gte("sale_date", minDate)
    .lte("sale_date", maxDate);

  if (locationCount === 1) {
    // Scope to the single location
    const singleLocationId = locations![0].id;
    deleteQuery = deleteQuery.eq("location_id", singleLocationId);
  }
  // If locationCount === 0, no scope needed (unusual but safe)

  const { error, count } = await deleteQuery;

  if (error) {
    return {
      deletedCount: 0,
      error: {
        message: "Error al eliminar ventas anteriores",
        code: "delete_failed",
      },
    };
  }

  return { deletedCount: count ?? 0 };
}
