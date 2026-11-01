// lib/restaurant/kitchen-buffer-server.ts
//
// «Merma de cocina» (kitchen buffer) of each restaurant: what Costos shows and
// the one write path. The value is a history (kitchen_buffer_settings,
// migration 075): the row with the latest effective_from <= the date. With no
// row in force the read-time default applies (lib/restaurant/yield-buffer.ts);
// this file never inserts a row to express a default.
//
//   «Solo desde hoy»            a row with effective_from = today. Past months
//                               keep the value they had.
//   «También meses anteriores»  a row with effective_from = the restaurant's
//                               first data date, and the older rows it
//                               replaces (effective_from <= today) are removed,
//                               so the past months now read the new value.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBusinessDayConfig } from "@/lib/restaurant/business-day-server";
import { cutoffFor } from "@/lib/restaurant/business-day";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { businessToday } from "@/lib/restaurant/rentabilidad";
import { loadSalesDetailCached } from "@/lib/restaurant/sales-detail-server";
import {
  MAX_BUFFER_PCT,
  loadResolvedBufferAt,
  type ResolvedBuffer,
} from "@/lib/restaurant/yield-buffer";

export type BufferScope = "today" | "all";

export interface RestaurantBuffer extends ResolvedBuffer {
  locationId: string;
  name: string;
}

/** The restaurant's business date today. */
export async function loadBusinessToday(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  now: Date = new Date()
): Promise<string> {
  const [timezone, config] = await Promise.all([
    resolvePosTimezone(supabase, companyId),
    loadBusinessDayConfig(supabase, companyId),
  ]);
  return businessToday(now, timezone, cutoffFor(config, locationId));
}

/** The first date the restaurant has sales for; null when it has none yet. */
export async function loadFirstDataDate(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string
): Promise<string | null> {
  const { cube } = await loadSalesDetailCached(supabase, companyId, locationId);
  const dates = cube.dates.filter((d): d is string => typeof d === "string");
  return dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** Each restaurant's buffer on `today`, saved or default. */
export async function loadRestaurantBuffers(
  supabase: SupabaseClient,
  companyId: string,
  locations: ReadonlyArray<{ id: string; name: string }>,
  today: string
): Promise<RestaurantBuffer[]> {
  return Promise.all(
    locations.map(async (l) => ({
      locationId: l.id,
      name: l.name,
      ...(await loadResolvedBufferAt(supabase, companyId, l.id, today)),
    }))
  );
}

export function isValidBufferPct(v: unknown): v is number {
  return (
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_BUFFER_PCT
  );
}

export type SaveBufferResult =
  | { ok: true; effectiveFrom: string }
  | { ok: false; error: "invalid" | "write_failed"; message?: string };

/**
 * Writes the new buffer. The caller has already checked the capability
 * (costs.buffer) and that `locationId` belongs to the company; the database
 * checks both again (RLS, migration 075).
 */
export async function saveKitchenBuffer(args: {
  supabase: SupabaseClient;
  companyId: string;
  userId: string;
  locationId: string;
  bufferPct: number;
  scope: BufferScope;
  /** The restaurant's business date today (YYYY-MM-DD). */
  today: string;
  /** The restaurant's first data date; null when it has no data yet. */
  firstDataDate: string | null;
}): Promise<SaveBufferResult> {
  const { supabase, companyId, locationId, today, scope } = args;
  if (!isValidBufferPct(args.bufferPct)) return { ok: false, error: "invalid" };
  const effectiveFrom =
    scope === "all" && args.firstDataDate && args.firstDataDate < today
      ? args.firstDataDate
      : today;
  const ins = await supabase
    .from("kitchen_buffer_settings")
    .insert({
      company_id: companyId,
      location_id: locationId,
      buffer_pct: args.bufferPct,
      effective_from: effectiveFrom,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data)
    return { ok: false, error: "write_failed", message: ins.error?.message };
  if (scope === "all") {
    // The older rows up to today are what «meses anteriores» replaces.
    const del = await supabase
      .from("kitchen_buffer_settings")
      .delete()
      .eq("company_id", companyId)
      .eq("location_id", locationId)
      .lte("effective_from", today)
      .neq("id", (ins.data as { id: string }).id);
    if (del.error)
      return { ok: false, error: "write_failed", message: del.error.message };
  }
  return { ok: true, effectiveFrom };
}
