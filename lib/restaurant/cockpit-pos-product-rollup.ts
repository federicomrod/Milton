// lib/restaurant/cockpit-pos-product-rollup.ts
//
// Client for migration 033 `cockpit_pos_product_rollup`. One JSON object
// of per-product totals so Overview / Menu Profitability do not page
// every pos_sales_items row. Missing RPC → callers fall back to the
// paginated reader. RPC/auth failure → empty totals (fail-closed).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingRpcError,
  logCockpitTiming,
} from "@/lib/restaurant/cockpit-pos-rollup";
import { isSameCurrency } from "@/lib/restaurant/currency";
import { classifySaleLine } from "@/lib/restaurant/sales-revenue";

type ProductSourceRow = {
  raw_item_name?: string | null;
  quantity?: number | null;
  gross_revenue?: number | null;
  net_revenue?: number | null;
  currency?: string | null;
  location_id?: string | null;
  is_tip?: boolean | null;
  discount_amount?: number | null;
  check_id?: string | null;
  order_id?: string | null;
};

export const COCKPIT_POS_PRODUCT_ROLLUP_RPC = "cockpit_pos_product_rollup";

export interface CockpitPosProductLine {
  raw_item_name: string;
  location_id: string | null;
  currency: string | null;
  is_tip: boolean;
  units: number;
  net: number;
  posted: number;
}

export interface CockpitPosProductRollup {
  row_count: number;
  distinct_check_count: number;
  currency_mismatch_rows: number;
  products: CockpitPosProductLine[];
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function productLine(item: unknown): CockpitPosProductLine[] {
  if (!item || typeof item !== "object") return [];
  const row = item as Record<string, unknown>;
  const raw_item_name = str(row.raw_item_name);
  if (!raw_item_name) return [];
  return [
    {
      raw_item_name,
      location_id: str(row.location_id),
      currency: str(row.currency),
      is_tip: row.is_tip === true,
      units: num(row.units),
      net: num(row.net),
      posted: num(row.posted),
    },
  ];
}

export function parseCockpitPosProductRollup(
  raw: unknown
): CockpitPosProductRollup | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (!Array.isArray(row.products) && row.row_count == null) return null;
  return {
    row_count: num(row.row_count),
    distinct_check_count: num(row.distinct_check_count),
    currency_mismatch_rows: num(row.currency_mismatch_rows),
    products: Array.isArray(row.products)
      ? row.products.flatMap(productLine)
      : [],
  };
}

export function emptyCockpitPosProductRollup(): CockpitPosProductRollup {
  return {
    row_count: 0,
    distinct_check_count: 0,
    currency_mismatch_rows: 0,
    products: [],
  };
}

/**
 * In-memory twin of `cockpit_pos_product_rollup`. Used to lock the TS
 * aggregator against the same grouping the SQL emits, without a DB.
 */
export function buildCockpitPosProductRollupFromRows(
  rows: ProductSourceRow[],
  companyCurrency?: string | null
): CockpitPosProductRollup {
  const distinct = new Set<string>();
  const buckets = new Map<
    string,
    CockpitPosProductLine & { units: number; net: number; posted: number }
  >();
  let currency_mismatch_rows = 0;
  for (const row of rows) {
    const check = row.check_id ?? row.order_id ?? null;
    if (check) distinct.add(check);
    const raw = (row.raw_item_name ?? "").trim();
    if (!raw) continue;
    if (
      companyCurrency &&
      row.currency &&
      !isSameCurrency(row.currency, companyCurrency)
    ) {
      currency_mismatch_rows += 1;
      continue;
    }
    const line = classifySaleLine(row);
    const units = line.isTip
      ? 0
      : typeof row.quantity === "number" && Number.isFinite(row.quantity)
        ? row.quantity
        : 0;
    const key = `${raw}\0${row.location_id ?? ""}\0${row.currency ?? ""}\0${line.isTip ? "1" : "0"}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        raw_item_name: raw,
        location_id: row.location_id ?? null,
        currency: row.currency ?? null,
        is_tip: line.isTip,
        units: 0,
        net: 0,
        posted: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.units += units;
    bucket.net += line.net;
    bucket.posted += line.posted;
  }
  return {
    row_count: rows.length,
    distinct_check_count: distinct.size,
    currency_mismatch_rows,
    products: Array.from(buckets.values()).map((b) => ({
      ...b,
      units: Math.round(b.units * 1000) / 1000,
      net: Math.round(b.net * 100) / 100,
      posted: Math.round(b.posted * 100) / 100,
    })),
  };
}

export async function fetchCockpitPosProductRollup(
  supabase: SupabaseClient,
  companyId: string,
  options: {
    locationId?: string | null;
    currency?: string | null;
  } = {}
): Promise<{
  rollup: CockpitPosProductRollup | null;
  missing: boolean;
  error: { message?: string; code?: string } | null;
  elapsedMs: number;
}> {
  const started = Date.now();
  if (typeof supabase.rpc !== "function") {
    logCockpitTiming("product-rpc", {
      ms: 0,
      source: "missing",
    });
    return {
      rollup: null,
      missing: true,
      error: null,
      elapsedMs: 0,
    };
  }
  try {
    const { data, error } = await supabase.rpc(COCKPIT_POS_PRODUCT_ROLLUP_RPC, {
      p_company_id: companyId,
      p_location_id: options.locationId ?? null,
      p_currency: options.currency ?? null,
    });
    if (error) {
      const missing = isMissingRpcError(error, COCKPIT_POS_PRODUCT_ROLLUP_RPC);
      logCockpitTiming("product-rpc", {
        ms: Date.now() - started,
        source: missing ? "missing" : "error",
        error: error.message,
        code: error.code,
      });
      if (!missing) {
        console.error(
          "[cockpit-pos-product-rollup] rpc failed:",
          error.message
        );
      }
      return {
        rollup: null,
        missing,
        error,
        elapsedMs: Date.now() - started,
      };
    }
    const rollup = parseCockpitPosProductRollup(data);
    const elapsedMs = Date.now() - started;
    if (!rollup) {
      logCockpitTiming("product-rpc", {
        ms: elapsedMs,
        source: "error",
        error: "cockpit_pos_product_rollup returned an unreadable payload",
      });
      return {
        rollup: null,
        missing: false,
        error: {
          message: "cockpit_pos_product_rollup returned an unreadable payload",
        },
        elapsedMs,
      };
    }
    logCockpitTiming("product-rpc", {
      ms: elapsedMs,
      source: "rpc",
      rows: rollup.row_count,
      products: rollup.products.length,
    });
    return {
      rollup,
      missing: false,
      error: null,
      elapsedMs,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = isMissingRpcError(
      { message },
      COCKPIT_POS_PRODUCT_ROLLUP_RPC
    );
    logCockpitTiming("product-rpc", {
      ms: Date.now() - started,
      source: missing ? "missing" : "error",
      error: message,
    });
    if (!missing) {
      console.error("[cockpit-pos-product-rollup] rpc threw:", err);
    }
    return {
      rollup: null,
      missing,
      error: { message },
      elapsedMs: Date.now() - started,
    };
  }
}
