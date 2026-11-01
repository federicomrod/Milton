// lib/restaurant/yield-buffer.ts
//
// Rentabilidad 1b (#404): ingredient yield loss and the kitchen buffer, both
// effective-dated history tables (migration 075). The value at a date is the
// row with the latest effective_from <= that date; changing the past or only
// «desde hoy» is just the choice of effective_from when a row is written.
//
// Read-only. A missing value is `null`, never 0 or the default: the caller
// decides what a missing yield or buffer means (⚑ Falta).

import type { SupabaseClient } from "@supabase/supabase-js";

/** The column default of kitchen_buffer_settings.buffer_pct (what a new row suggests). */
export const DEFAULT_BUFFER_PCT = 5;
export const MAX_BUFFER_PCT = 30;

/**
 * The release date of the 5% default kitchen buffer. A restaurant with no
 * kitchen_buffer_settings row in force on a date is read as 5% for dates on or
 * after this one and 0% before it. Never a row: the default is resolved at
 * read time. It is a single constant on purpose: Sofia's decision is that we
 * move it to the real release date when we release (2026-11-02 for now).
 */
export const BUFFER_DEFAULT_FROM = "2026-11-02";

/** The buffer % used for a date when no row is in force (read time, no rows). */
export function defaultBufferPct(date: string): number {
  return DATE_RE.test(date) && date >= BUFFER_DEFAULT_FROM
    ? DEFAULT_BUFFER_PCT
    : 0;
}

export interface ResolvedBuffer {
  bufferPct: number;
  /** The row's effective_from; null when the default applies. */
  effectiveFrom: string | null;
  /** True when no saved row is in force and the read-time default is used. */
  isDefault: boolean;
}

export type YieldStatus = "draft" | "approved";

export interface IngredientYieldRow {
  id: string;
  ingredient_id: string;
  loss_pct: number;
  source: string;
  status: YieldStatus;
  effective_from: string;
  created_at?: string;
}

export interface KitchenBufferRow {
  id: string;
  location_id: string;
  buffer_pct: number;
  effective_from: string;
  created_at?: string;
}

export interface YieldAt {
  lossPct: number;
  effectiveFrom: string;
}

export interface BufferAt {
  bufferPct: number;
  effectiveFrom: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The row in force at `date` (YYYY-MM-DD): the latest effective_from <= date;
 * two rows on the same day: the one created last. null when none applies or
 * `date` is not a date.
 */
export function pickValueAt<
  T extends { effective_from: string; created_at?: string },
>(rows: readonly T[], date: string): T | null {
  if (!DATE_RE.test(date)) return null;
  let best: T | null = null;
  for (const row of rows) {
    const from = row.effective_from.slice(0, 10);
    if (from > date) continue;
    if (!best) {
      best = row;
      continue;
    }
    const bestFrom = best.effective_from.slice(0, 10);
    if (
      from > bestFrom ||
      (from === bestFrom && (row.created_at ?? "") > (best.created_at ?? ""))
    )
      best = row;
  }
  return best;
}

/** The approved yield loss of one ingredient at `date` (drafts never count). */
export function yieldAt(
  rows: readonly IngredientYieldRow[],
  ingredientId: string,
  date: string
): YieldAt | null {
  const row = pickValueAt(
    rows.filter(
      (r) => r.ingredient_id === ingredientId && r.status === "approved"
    ),
    date
  );
  return row
    ? { lossPct: Number(row.loss_pct), effectiveFrom: row.effective_from }
    : null;
}

/** The kitchen buffer of one restaurant at `date`. */
export function bufferAt(
  rows: readonly KitchenBufferRow[],
  locationId: string,
  date: string
): BufferAt | null {
  const row = pickValueAt(
    rows.filter((r) => r.location_id === locationId),
    date
  );
  return row
    ? { bufferPct: Number(row.buffer_pct), effectiveFrom: row.effective_from }
    : null;
}

/**
 * The kitchen buffer of one restaurant at `date`, always a number: the saved
 * row in force, else the read-time default (5% from BUFFER_DEFAULT_FROM, 0%
 * before). A saved row always wins over the default.
 */
export function resolveBufferAt(
  rows: readonly KitchenBufferRow[],
  locationId: string,
  date: string
): ResolvedBuffer {
  const hit = bufferAt(rows, locationId, date);
  if (hit)
    return {
      bufferPct: hit.bufferPct,
      effectiveFrom: hit.effectiveFrom,
      isDefault: false,
    };
  return {
    bufferPct: defaultBufferPct(date),
    effectiveFrom: null,
    isDefault: true,
  };
}

/**
 * The approved yield loss of each ingredient at `date`, in ONE query. An
 * ingredient with no approved yield by then is absent from the map.
 */
export async function loadYieldsAt(
  supabase: SupabaseClient,
  companyId: string,
  ingredientIds: readonly string[],
  date: string
): Promise<Map<string, YieldAt>> {
  const out = new Map<string, YieldAt>();
  if (!ingredientIds.length || !DATE_RE.test(date)) return out;
  const { data, error } = await supabase
    .from("ingredient_yields")
    .select(
      "id, ingredient_id, loss_pct, source, status, effective_from, created_at"
    )
    .eq("company_id", companyId)
    .eq("status", "approved")
    .in("ingredient_id", [...ingredientIds])
    .lte("effective_from", date)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as IngredientYieldRow[];
  for (const id of new Set(ingredientIds)) {
    const hit = yieldAt(rows, id, date);
    if (hit) out.set(id, hit);
  }
  return out;
}

/** The kitchen buffer of one restaurant at `date`, or null when none is set by then. */
export async function loadBufferAt(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  date: string
): Promise<BufferAt | null> {
  if (!DATE_RE.test(date)) return null;
  const { data, error } = await supabase
    .from("kitchen_buffer_settings")
    .select("id, location_id, buffer_pct, effective_from, created_at")
    .eq("company_id", companyId)
    .eq("location_id", locationId)
    .lte("effective_from", date)
    .order("effective_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return bufferAt((data ?? []) as KitchenBufferRow[], locationId, date);
}

/** loadBufferAt + the read-time default: the buffer to cost with on `date`. Read-only. */
export async function loadResolvedBufferAt(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  date: string
): Promise<ResolvedBuffer> {
  const hit = await loadBufferAt(supabase, companyId, locationId, date);
  if (hit)
    return {
      bufferPct: hit.bufferPct,
      effectiveFrom: hit.effectiveFrom,
      isDefault: false,
    };
  return {
    bufferPct: defaultBufferPct(date),
    effectiveFrom: null,
    isDefault: true,
  };
}
