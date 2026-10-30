// The Preparaciones list: every preparation, its status, what is still open
// and what approving it unlocks (dishes and share of net sales). Company
// comes from auth, never from the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { fetchCostingRecipeVersions } from "@/lib/restaurant/costing-versions";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { loadPosProductList } from "@/lib/restaurant/pos-product-list-server";
import type { PosProductListResult } from "@/lib/restaurant/pos-product-list";
import {
  impactLabel,
  preparationImpact,
  type PreparationImpact,
} from "./preparation-impact";
import { PREPARATION_DRAFT_KIND } from "./prefill-preparations";

export interface PreparationRow {
  component_id: string;
  name: string;
  status: "borrador" | "aprobada" | "sin_receta";
  open_note: string | null;
  yield_to_confirm: boolean;
  impact: PreparationImpact;
  impact_label: string;
}

export interface PreparationsOverview {
  rows: PreparationRow[];
  drafts: number;
  approved: number;
}

function latest<T extends { version_number: number }>(rows: readonly T[]) {
  return rows.slice().sort((a, b) => b.version_number - a.version_number)[0];
}

export async function loadPreparationsOverview(
  supabase: SupabaseClient,
  input: {
    companyId: string;
    /** Language of the impact labels (default Spanish). */
    lang?: PreferredLanguage;
    locationId?: string | null;
    /** The product list the caller already built (R1-13): not read again. */
    list?: PosProductListResult;
  }
): Promise<PreparationsOverview> {
  const [components, versions, items, products] = await Promise.all([
    fetchAllRows<{ id: string; name: string }>(() =>
      supabase
        .from("prepared_components")
        .select("id, name")
        .eq("company_id", input.companyId)
    ),
    fetchCostingRecipeVersions(supabase, input.companyId),
    fetchAllRows<{ raw_values: Record<string, unknown>; reason: string }>(() =>
      supabase
        .from("cost_import_review_items")
        .select("raw_values, reason")
        .eq("company_id", input.companyId)
        .eq("status", "pending")
        .eq("raw_values->>kind", PREPARATION_DRAFT_KIND)
    ),
    input.list
      ? Promise.resolve({ ok: true as const, list: input.list })
      : loadPosProductList(supabase, {
          companyId: input.companyId,
          locationId: input.locationId ?? null,
        }),
  ]);
  if (components.error) throw new Error(components.error.message);

  // Preparation -> preparations its current version uses.
  const children = new Map<string, string[]>();
  const statusOf = new Map<string, string>();
  for (const [
    componentId,
    rows,
  ] of versions.componentRecipeVersionsByComponentId) {
    const current = latest(rows);
    if (!current) continue;
    statusOf.set(componentId, current.status);
    const inputs =
      versions.componentRecipeVersionInputsByVersionId.get(current.id) ?? [];
    children.set(
      componentId,
      inputs.flatMap((i) => (i.component_id ? [i.component_id] : []))
    );
  }

  // Dishes sold, with the preparations their current recipe uses.
  const dishes = (products.ok ? products.list.products : []).flatMap(
    (product) => {
      if (!product.menu_item_id || !product.in_food_sales) return [];
      const rows =
        versions.menuRecipeVersionsByMenuItemId.get(product.menu_item_id) ?? [];
      const current = latest(rows);
      if (!current) return [];
      const inputs =
        versions.menuRecipeVersionInputsByVersionId.get(current.id) ?? [];
      return [
        {
          odoo_product_id: product.odoo_product_id,
          net_sales: product.net_sales,
          component_ids: inputs.flatMap((i) =>
            i.component_id ? [i.component_id] : []
          ),
        },
      ];
    }
  );
  const impact = preparationImpact({
    dishes,
    children,
    // Shares of food sales: the same denominator as coverage.
    totalNetSales: products.ok ? products.list.food_net_sales : 0,
  });

  const openByComponent = new Map<
    string,
    { note: string; yieldOpen: boolean }
  >();
  for (const item of items.rows) {
    const id = item.raw_values.component_id;
    if (typeof id !== "string") continue;
    const y = item.raw_values.yield as Record<string, unknown> | undefined;
    openByComponent.set(id, {
      note: item.reason,
      yieldOpen: Boolean(y && y.confirmed === false),
    });
  }

  const rows: PreparationRow[] = components.rows.map((component) => {
    const status = statusOf.get(component.id);
    const open = openByComponent.get(component.id);
    const im = impact.get(component.id) ?? {
      dishes: 0,
      net_sales: 0,
      share_pct: 0,
    };
    return {
      component_id: component.id,
      name: component.name,
      status:
        status === "approved"
          ? "aprobada"
          : status === "in_review"
            ? "borrador"
            : "sin_receta",
      open_note: open?.note ?? null,
      yield_to_confirm: open?.yieldOpen ?? false,
      impact: im,
      impact_label: impactLabel(im, input.lang),
    };
  });

  // Drafts first, most impact first: confirming these unlocks the most.
  const rank = { borrador: 0, sin_receta: 1, aprobada: 2 } as const;
  rows.sort(
    (a, b) =>
      rank[a.status] - rank[b.status] ||
      b.impact.net_sales - a.impact.net_sales ||
      b.impact.dishes - a.impact.dishes ||
      a.name.localeCompare(b.name, "es")
  );
  return {
    rows,
    drafts: rows.filter((r) => r.status === "borrador").length,
    approved: rows.filter((r) => r.status === "aprobada").length,
  };
}
