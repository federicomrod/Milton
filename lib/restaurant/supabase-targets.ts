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
import {
  LEGACY_FROM,
  dailySalesTarget,
  pickTargetRow,
  toTargetRow,
  type TargetRow,
} from "@/lib/restaurant/objetivos";

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

export { LEGACY_FROM };

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
  companyId: string,
  /** The day the daily figure is for (default: today, UTC). */
  today: string = new Date().toISOString().slice(0, 10)
): Promise<TargetMap> {
  const config = await loadTargetsConfig(supabase, companyId);
  const rows = config.rows;
  const out: TargetMap = {};
  // Company-wide only: the Ventas lines are for the whole company.
  const scope = { locationId: null, restaurantIds: [] };
  const revenue = dailySalesTarget(rows, today, scope);
  if (revenue !== null) out.revenue = revenue;
  for (const key of ["orders", "units_sold", "avg_ticket"] as const) {
    const row = pickTargetRow(rows, key, today, null);
    if (row) out[key] = row.target_value;
  }
  return out;
}

const NEW_COLUMNS =
  "metric_key, target_value, target_period, is_active, location_id, effective_from, weekday_weights";
const OLD_COLUMNS = "metric_key, target_value, target_period, is_active";

export interface TargetsConfig {
  /** Migration 052 applied: monthly targets, restaurants and start dates work. */
  available: boolean;
  rows: TargetRow[];
}

/**
 * Every target of the company, as the app reads them. Before migration 052
 * the new columns do not exist: the old daily rows are read as they were
 * (valid for all history) and `available` is false. A read error returns no
 * targets (nothing is drawn, never a 0).
 */
export async function loadTargetsConfig(
  supabase: SupabaseClient,
  companyId: string
): Promise<TargetsConfig> {
  const read = async (columns: string) =>
    supabase
      .from("restaurant_kpi_targets")
      .select(columns)
      .eq("company_id", companyId)
      .limit(2000);
  let res = await read(NEW_COLUMNS);
  let available = true;
  if (res.error) {
    available = false;
    res = await read(OLD_COLUMNS);
    if (res.error) {
      console.error("[supabase-targets] read failed:", res.error.message);
      return { available: false, rows: [] };
    }
  }
  const rows = ((res.data ?? []) as unknown as Array<Record<string, unknown>>)
    .map(toTargetRow)
    .filter((r): r is TargetRow => r !== null);
  return { available, rows };
}

/** The company's default "Comparar con" (Objetivos), or null before 052 / when unset. */
export async function loadDefaultComparison(
  supabase: SupabaseClient,
  companyId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("restaurant_company_settings")
    .select("default_comparison")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error || !data) return null;
  return typeof data.default_comparison === "string"
    ? data.default_comparison
    : null;
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
  // A daily company-wide row. Read-then-write (the unique key changed with
  // migration 052, so there is no single conflict target that fits before
  // and after it): update the row there is, else add one.
  const columns =
    "id, company_id, metric_key, target_value, target_period, currency, is_active";
  const existing = await supabase
    .from("restaurant_kpi_targets")
    .select("id, target_value")
    .eq("company_id", params.company_id)
    .eq("metric_key", params.metric_key)
    .eq("target_period", "daily")
    .order("id", { ascending: true })
    .limit(50);
  if (existing.error) throw new Error(existing.error.message);
  const target = existing.data?.[existing.data.length - 1];
  const patch = {
    target_value: params.target_value,
    currency: params.currency ?? "USD",
    is_active: true,
  };
  const { data, error } = target
    ? await supabase
        .from("restaurant_kpi_targets")
        .update(patch)
        .eq("id", target.id)
        .eq("company_id", params.company_id)
        .select(columns)
        .single()
    : await supabase
        .from("restaurant_kpi_targets")
        .insert({
          company_id: params.company_id,
          metric_key: params.metric_key,
          target_period: "daily",
          ...patch,
        })
        .select(columns)
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
