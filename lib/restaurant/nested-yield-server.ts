// lib/restaurant/nested-yield-server.ts
//
// Reads the preparation graph (who uses whom, whose batch output is
// measured) for the nested yield rule. Read only. A preparation is measured
// when its newest version has a positive batch output and no pending draft
// still carries the import's assumed «1 orden».

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { yieldOf } from "@/lib/restaurant/recipe-costing/editor-service";
import { PREPARATION_DRAFT_KIND } from "@/lib/restaurant/recipe-costing/prefill-preparations";
import type { PrepNode } from "@/lib/restaurant/nested-yield";

export async function loadPrepGraph(
  supabase: SupabaseClient,
  companyId: string
): Promise<Map<string, PrepNode>> {
  const [versions, drafts] = await Promise.all([
    fetchAllRows<{
      id: string;
      component_id: string;
      version_number: number;
      output_quantity: number | null;
    }>(() =>
      supabase
        .from("component_recipe_versions")
        .select("id, component_id, version_number, output_quantity")
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
  type Version = (typeof versions.rows)[number];
  const newest = new Map<string, Version>();
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
  const versionIds = [...newest.values()].map((v) => v.id);
  const inputs = versionIds.length
    ? await fetchAllRows<{
        component_recipe_version_id: string;
        component_id: string | null;
      }>(() =>
        supabase
          .from("component_recipe_version_inputs")
          .select("component_recipe_version_id, component_id")
          .eq("company_id", companyId)
          .eq("input_type", "component")
      )
    : {
        rows: [] as {
          component_recipe_version_id: string;
          component_id: string | null;
        }[],
        error: null as { message?: string } | null,
      };
  if (inputs.error) throw new Error(inputs.error.message ?? "read failed");
  const childrenOf = new Map<string, string[]>();
  const byVersion = new Map(
    [...newest.values()].map((v) => [v.id, v.component_id])
  );
  for (const row of inputs.rows) {
    const parent = byVersion.get(row.component_recipe_version_id);
    if (!parent || !row.component_id) continue;
    const list = childrenOf.get(parent) ?? [];
    list.push(row.component_id);
    childrenOf.set(parent, list);
  }
  const out = new Map<string, PrepNode>();
  for (const [id, v] of newest)
    out.set(id, {
      id,
      measured: Number(v.output_quantity) > 0 && !unconfirmed.has(id),
      children: childrenOf.get(id) ?? [],
    });
  return out;
}
