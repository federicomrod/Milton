// lib/restaurant/supabase-targets.ts
//
// Read / write helpers for the per-company restaurant KPI targets table
// (migration 003_create_restaurant_kpi_targets.sql).
//
// Design notes:
//   - Server-side only. Both API routes and the server page import from
//     here; the client component receives the resolved targets as props
//     and POSTs deltas via /api/restaurant/targets.
//   - All access is RLS-scoped: we use the authenticated user's Supabase
//     client. No service-role calls.
//   - The table only stores active rows we care about; the explorer treats
//     a missing row as "no target" rather than "target = 0".
//
// Currency:
//   target_value is stored as numeric(14,4) — the canonical unit for the
//   tenant. The dashboard formats with the tenant's POS currency.

import type { SupabaseClient } from "@supabase/supabase-js";

export type TargetMetricKey =
  | "revenue"
  | "orders"
  | "units_sold"
  | "avg_ticket";

export const TARGET_METRIC_KEYS: ReadonlyArray<TargetMetricKey> = [
  "revenue",
  "orders",
  "units_sold",
  "avg_ticket",
];

export interface KpiTargetRow {
  id: string;
  company_id: string;
  metric_key: TargetMetricKey;
  target_value: number;
  target_period: "daily";
  currency: string | null;
  is_active: boolean;
}

/**
 * Map of metric_key → numeric daily target. Missing keys mean "no target"
 * — never imply zero. Callers use `targets[k] ?? null` patterns.
 */
export type TargetMap = Partial<Record<TargetMetricKey, number>>;

/** True if v is a real, finite, non-negative number. */
function isPositiveNumeric(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Returns all daily targets for the company. Inactive rows are filtered out
 * (we keep them in-table in case a future "toggle off" UI lands; the
 * dashboard only consumes active rows).
 *
 * On any DB error we log and return an empty map — the dashboard must
 * stay usable even when the targets table is unreachable.
 */
export async function getRestaurantKpiTargets(
  supabase: SupabaseClient,
  companyId: string
): Promise<TargetMap> {
  const { data, error } = await supabase
    .from("restaurant_kpi_targets")
    .select("metric_key, target_value, is_active, target_period")
    .eq("company_id", companyId)
    .eq("target_period", "daily")
    .eq("is_active", true);

  if (error) {
    console.error("[supabase-targets] read failed:", error.message);
    return {};
  }

  const out: TargetMap = {};
  for (const row of data ?? []) {
    const key = row.metric_key as TargetMetricKey;
    if (!TARGET_METRIC_KEYS.includes(key)) continue;
    const value = Number(row.target_value);
    if (!Number.isFinite(value) || value < 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Upserts a single (company_id, metric_key, daily) target. Returns the
 * resolved row, or throws when the value fails server-side validation.
 *
 * "Empty / null / 0 with intent to clear" is intentionally NOT handled
 * here — the upsert always inserts/updates a real row. If the caller
 * wants to "delete" a target, deactivate the row separately.
 */
export async function upsertRestaurantKpiTarget(
  supabase: SupabaseClient,
  params: {
    company_id: string;
    metric_key: TargetMetricKey;
    target_value: number;
    currency?: string;
  }
): Promise<KpiTargetRow> {
  if (!TARGET_METRIC_KEYS.includes(params.metric_key)) {
    throw new Error(`Unknown metric_key: ${params.metric_key}`);
  }
  if (!isPositiveNumeric(params.target_value)) {
    throw new Error(
      `Invalid target_value for ${params.metric_key}: must be a non-negative finite number`
    );
  }

  const { data, error } = await supabase
    .from("restaurant_kpi_targets")
    .upsert(
      {
        company_id: params.company_id,
        metric_key: params.metric_key,
        target_period: "daily",
        target_value: params.target_value,
        currency: params.currency ?? "MXN",
        is_active: true,
      },
      {
        // The migration's UNIQUE(company_id, metric_key, target_period)
        // constraint backs this so a re-save doesn't create duplicates.
        onConflict: "company_id,metric_key,target_period",
      }
    )
    .select(
      "id, company_id, metric_key, target_value, target_period, currency, is_active"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Upsert returned no row");
  }
  return data as KpiTargetRow;
}

/** Reasonable default daily targets surfaced as placeholders in the editor
 *  when nothing is set yet. NOT persisted unless the user clicks Save. */
export function getDefaultTargets(): TargetMap {
  return {
    revenue: 20000,
    orders: 50,
    units_sold: 120,
    avg_ticket: 400,
  };
}
