// Company-scoped read of the line counts per recipe version (one paged read,
// no query per plato). Only the version id comes back, never the lines.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { countLinesByVersion } from "./has-recipe";

export async function loadVersionLineCounts(
  supabase: SupabaseClient,
  companyId: string,
  versionIds?: readonly string[]
): Promise<Map<string, number>> {
  if (versionIds && versionIds.length === 0) return new Map();
  const result = await fetchAllRows<{ id: string; recipe_version_id: string }>(
    () => {
      let q = supabase
        .from("recipe_version_inputs")
        .select("id, recipe_version_id")
        .eq("company_id", companyId);
      if (versionIds && versionIds.length <= 200) {
        q = q.in("recipe_version_id", [...versionIds]);
      }
      return q;
    }
  );
  if (result.error) throw new Error(result.error.message ?? "version lines");
  const wanted = versionIds ? new Set(versionIds) : null;
  return countLinesByVersion(
    wanted
      ? result.rows.filter((row) => wanted.has(row.recipe_version_id))
      : result.rows
  );
}
