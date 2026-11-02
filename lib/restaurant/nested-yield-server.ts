// lib/restaurant/nested-yield-server.ts
//
// Reads the preparation graph (who uses whom, whose batch output is
// measured) for the nested yield rule. Read only. A preparation is measured
// when its newest version has a positive batch output and no pending draft
// still carries the import's assumed «1 orden».

import { isMeasuredOutput } from "@/lib/restaurant/prep-yield";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { yieldOf } from "@/lib/restaurant/recipe-costing/editor-service";
import { PREPARATION_DRAFT_KIND } from "@/lib/restaurant/recipe-costing/prefill-preparations";
import type { PrepNode } from "@/lib/restaurant/nested-yield";
import type { PrepDef } from "@/lib/restaurant/merma-visibility";

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
      status: string | null;
    }>(() =>
      supabase
        .from("component_recipe_versions")
        .select("id, component_id, version_number, output_quantity, status")
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
  // What an open draft says about each preparation's yield (none = no reading).
  const evidence = new Map<string, { confirmed: boolean }>();
  for (const d of drafts.rows) {
    const raw = d.raw_values ?? {};
    const y = yieldOf(raw);
    if (typeof raw.component_id === "string")
      evidence.set(raw.component_id, { confirmed: y ? y.confirmed : false });
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
      measured: isMeasuredOutput({
        quantity: v.output_quantity,
        status: v.status,
        evidence: evidence.get(id) ?? null,
      }),
      children: childrenOf.get(id) ?? [],
    });
  return out;
}

/**
 * The preparations' recipes as the «Impacto merma» share needs them: each
 * one's batch output, whether it is measured, and its lines. Read only.
 */
export async function loadPrepDefs(
  supabase: SupabaseClient,
  companyId: string,
  graph: Map<string, PrepNode>
): Promise<Record<string, PrepDef>> {
  const versions = await fetchAllRows<{
    id: string;
    component_id: string;
    version_number: number;
    output_quantity: number | null;
    output_unit: string | null;
  }>(() =>
    supabase
      .from("component_recipe_versions")
      .select("id, component_id, version_number, output_quantity, output_unit")
      .eq("company_id", companyId)
  );
  if (versions.error) throw new Error(versions.error.message ?? "read failed");
  const newest = new Map<string, (typeof versions.rows)[number]>();
  for (const v of versions.rows) {
    const cur = newest.get(v.component_id);
    if (!cur || v.version_number > cur.version_number)
      newest.set(v.component_id, v);
  }
  const inputs = await fetchAllRows<{
    component_recipe_version_id: string;
    input_type: "ingredient" | "component";
    ingredient_id: string | null;
    component_id: string | null;
    quantity: number | null;
    unit: string | null;
  }>(() =>
    supabase
      .from("component_recipe_version_inputs")
      .select(
        "component_recipe_version_id, input_type, ingredient_id, component_id, quantity, unit"
      )
      .eq("company_id", companyId)
  );
  if (inputs.error) throw new Error(inputs.error.message ?? "read failed");
  const byVersion = new Map<string, PrepDef>();
  for (const [id, v] of newest)
    byVersion.set(v.id, {
      id,
      outputQty: v.output_quantity === null ? null : Number(v.output_quantity),
      outputUnit: v.output_unit,
      measured: graph.get(id)?.measured ?? false,
      lines: [],
    });
  for (const row of inputs.rows) {
    const def = byVersion.get(row.component_recipe_version_id);
    if (!def) continue;
    const qty = row.quantity === null ? null : Number(row.quantity);
    if (row.input_type === "ingredient" && row.ingredient_id)
      def.lines.push({
        kind: "ingredient",
        ingredientId: row.ingredient_id,
        qty,
        unit: row.unit,
      });
    else if (row.input_type === "component" && row.component_id)
      def.lines.push({
        kind: "component",
        componentId: row.component_id,
        qty,
        unit: row.unit,
      });
  }
  return Object.fromEntries([...byVersion.values()].map((d) => [d.id, d]));
}
