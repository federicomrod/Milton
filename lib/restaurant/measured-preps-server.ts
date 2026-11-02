// lib/restaurant/measured-preps-server.ts
//
// Which preparations have a measured batch output today (the recipe editor's
// rule: a confirmed yield; the Excel import's assumed «1 orden» is not). Read
// only. Used to show «—» in «Impacto merma» for lines under such a preparation.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { yieldOf } from "@/lib/restaurant/recipe-costing/editor-service";
import { PREPARATION_DRAFT_KIND } from "@/lib/restaurant/recipe-costing/prefill-preparations";

export async function loadMeasuredPrepIds(
  supabase: SupabaseClient,
  companyId: string
): Promise<Set<string>> {
  const [versions, drafts] = await Promise.all([
    fetchAllRows<{
      component_id: string;
      version_number: number;
      output_quantity: number | null;
    }>(() =>
      supabase
        .from("component_recipe_versions")
        .select("component_id, version_number, output_quantity")
        .eq("company_id", companyId)
    ),
    fetchAllRows<{ raw_values: Record<string, unknown> | null }>(() =>
      supabase
        .from("cost_import_review_items")
        .select("raw_values")
        .eq("company_id", companyId)
        .eq("status", "pending")
        .eq("raw_values->>kind", PREPARATION_DRAFT_KIND)
    ),
  ]);
  for (const res of [versions, drafts])
    if (res.error) throw new Error(res.error.message ?? "read failed");
  const newest = new Map<string, (typeof versions.rows)[number]>();
  for (const v of versions.rows) {
    const cur = newest.get(v.component_id);
    if (!cur || v.version_number > cur.version_number)
      newest.set(v.component_id, v);
  }
  const unconfirmed = new Set<string>();
  for (const d of drafts.rows) {
    const raw = d.raw_values ?? {};
    const y = yieldOf(raw);
    if (typeof raw.component_id === "string" && (!y || !y.confirmed))
      unconfirmed.add(raw.component_id);
  }
  const out = new Set<string>();
  for (const [id, v] of newest)
    if (Number(v.output_quantity) > 0 && !unconfirmed.has(id)) out.add(id);
  return out;
}
