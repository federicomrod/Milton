// lib/restaurant/pos-product-list-server.ts
//
// Loads Odoo POS sales, links and recipe versions for one company, then
// ranks products and computes coverage on the server. Company id comes
// from auth — never from the request.

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import { fetchAllRowsRetryingWithoutColumns } from "@/lib/restaurant/missing-schema-column";
import {
  classificationFromStored,
  isPosProductLinkState,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  buildPosProductList,
  type PosProductListResult,
  type PosSaleLineForProductList,
  type RecipeVersionForCoverage,
} from "@/lib/restaurant/pos-product-list";

const SALES_SELECT = [
  "company_id",
  "location_id",
  "raw_item_name",
  "quantity",
  "category",
  "gross_revenue",
  "net_revenue",
  "is_tip",
  "source_metadata",
  "external_line_id",
  "combo_parent_external_line_id",
  "combo_parent_odoo_product_id",
].join(", ");

const OPTIONAL_SALES_COLUMNS = [
  "combo_parent_external_line_id",
  "combo_parent_odoo_product_id",
  "is_tip",
  "category",
] as const;

export interface LoadPosProductListParams {
  companyId: string;
  startDate?: string | null;
  endDate?: string | null;
  locationId?: string | null;
  /** Only this product's own sales (one dish, not the whole menu). */
  odooProductId?: number | null;
}

export type LoadPosProductListResult =
  | {
      ok: true;
      list: PosProductListResult;
      /** The links the list was built from (dish-economics reuses them). */
      links: PosProductLinkRecord[];
    }
  | { ok: false; error: string };

function asLink(row: Record<string, unknown>): PosProductLinkRecord | null {
  const odooProductId = row.odoo_product_id;
  if (typeof odooProductId !== "number" || !Number.isInteger(odooProductId)) {
    return null;
  }
  if (typeof row.company_id !== "string" || typeof row.odoo_name !== "string") {
    return null;
  }
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    company_id: row.company_id,
    location_id: typeof row.location_id === "string" ? row.location_id : null,
    odoo_product_id: odooProductId,
    odoo_name: row.odoo_name,
    classification: classificationFromStored(row.classification),
    menu_item_id:
      typeof row.menu_item_id === "string" ? row.menu_item_id : null,
    link_state: isPosProductLinkState(row.link_state)
      ? row.link_state
      : "sin_vincular",
    confirmed_by:
      typeof row.confirmed_by === "string" ? row.confirmed_by : null,
    confirmed_at:
      typeof row.confirmed_at === "string" ? row.confirmed_at : null,
    confirmed_how:
      typeof row.confirmed_how === "string" ? row.confirmed_how : null,
    evidence:
      row.evidence &&
      typeof row.evidence === "object" &&
      !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {},
  };
}

export async function loadPosProductList(
  supabase: SupabaseClient,
  params: LoadPosProductListParams
): Promise<LoadPosProductListResult> {
  const { companyId, startDate, endDate, locationId, odooProductId } = params;

  const [salesRes, linksRes, versionsRes] = await Promise.all([
    fetchAllRowsRetryingWithoutColumns<PosSaleLineForProductList>(
      OPTIONAL_SALES_COLUMNS,
      (select) => {
        let q = supabase
          .from("pos_sales_items")
          .select(select)
          .eq("company_id", companyId)
          .eq("pos_source", "odoo");
        if (locationId) q = q.eq("location_id", locationId);
        if (odooProductId != null) {
          q = q.eq("source_metadata->>product_id", String(odooProductId));
        }
        if (startDate) q = q.gte("sale_date", startDate);
        if (endDate) q = q.lte("sale_date", endDate);
        return q;
      },
      SALES_SELECT
    ),
    fetchAllRows<Record<string, unknown>>(() =>
      supabase
        .from("pos_product_links")
        .select(
          "id, company_id, location_id, odoo_product_id, odoo_name, classification, menu_item_id, link_state, confirmed_by, confirmed_at, confirmed_how, evidence"
        )
        .eq("company_id", companyId)
    ),
    fetchAllRows<RecipeVersionForCoverage>(() =>
      supabase
        .from("recipe_versions")
        .select("menu_item_id, status")
        .eq("company_id", companyId)
    ),
  ]);

  if (salesRes.error) {
    console.error(
      "[pos-product-list] pos_sales_items:",
      salesRes.error.message
    );
    return { ok: false, error: "No se pudieron leer las ventas del POS." };
  }
  if (linksRes.error) {
    console.error(
      "[pos-product-list] pos_product_links:",
      linksRes.error.message
    );
    return { ok: false, error: "No se pudieron leer los vínculos POS." };
  }
  if (versionsRes.error) {
    console.error(
      "[pos-product-list] recipe_versions:",
      versionsRes.error.message
    );
    return { ok: false, error: "No se pudieron leer las versiones de receta." };
  }

  const links = (linksRes.rows ?? [])
    .map(asLink)
    .filter((row): row is PosProductLinkRecord => row !== null);

  return {
    ok: true,
    links,
    list: buildPosProductList({
      companyId,
      sales: salesRes.rows ?? [],
      links,
      recipeVersions: versionsRes.rows ?? [],
      locationId: locationId ?? null,
    }),
  };
}
