// A merge (migration 051) archives the losing ingredients (archived_at) and
// points their names at the survivor through ingredient_aliases. Anything that
// PICKS or SAVES an ingredient must use only the active ones, so a recipe never
// ends up on a dead row. Before the archive column exists nothing is hidden.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export interface CompanyIngredientRow {
  id: string;
  name: string;
  default_unit: string | null;
  /** Set when the ingredient was merged away or hidden; null = active. */
  archived_at: string | null;
}

/**
 * Every ingredient of the company (active and archived), in pages. Falls back
 * to "all active" when the archived_at column does not exist yet.
 */
export async function loadCompanyIngredients(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyIngredientRow[]> {
  const withArchive = await fetchAllRows<{
    id: string;
    name: string;
    default_unit: string | null;
    archived_at: string | null;
  }>(() =>
    supabase
      .from("ingredients")
      .select("id, name, default_unit, archived_at")
      .eq("company_id", companyId)
  );
  if (!withArchive.error) {
    return withArchive.rows.map((row) => ({
      ...row,
      archived_at: row.archived_at ?? null,
    }));
  }
  if (!/archived_at/.test(withArchive.error.message ?? "")) return [];
  const plain = await fetchAllRows<{
    id: string;
    name: string;
    default_unit: string | null;
  }>(() =>
    supabase
      .from("ingredients")
      .select("id, name, default_unit")
      .eq("company_id", companyId)
  );
  return plain.error
    ? []
    : plain.rows.map((row) => ({ ...row, archived_at: null }));
}

export const isActiveIngredient = (row: { archived_at: string | null }) =>
  !row.archived_at;

/** The refusal for a line that points at an archived ingredient. */
export function archivedIngredientMessage(
  name: string,
  survivorName: string | null,
  lang: PreferredLanguage = "es"
): string {
  const m = getDictionary(lang).menu.screens.merge;
  const survivor = survivorName?.trim();
  return survivor
    ? fmt(m.archivedMerged, { name, survivor })
    : fmt(m.archivedPlain, { name });
}
