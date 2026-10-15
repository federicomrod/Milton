// lib/restaurant/business-day-server.ts
//
// R1-17a: loads the shifts (migration 054) and builds the BusinessDayConfig
// the row walks use. Read-only. Before 054 the table does not exist: the
// config says so and everything keeps today's behaviour (no cutoff).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBusinessDayConfig,
  NO_BUSINESS_DAY,
  type BusinessDayConfig,
  type Shift,
} from "@/lib/restaurant/business-day";

export interface ShiftRow extends Shift {
  id: string;
  restaurant_id: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseShiftRows(raw: unknown): ShiftRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ShiftRow[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const weekdays = Array.isArray(r.weekdays)
      ? r.weekdays.filter((d): d is number => Number.isInteger(d))
      : [];
    if (!str(r.id) || !str(r.restaurant_id) || !str(r.name)) continue;
    out.push({
      id: str(r.id),
      restaurant_id: str(r.restaurant_id),
      name: str(r.name),
      // Postgres returns time as HH:MM:SS
      start_time: str(r.start_time).slice(0, 5),
      end_time: str(r.end_time).slice(0, 5),
      weekdays,
      active: r.active !== false,
      sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
    });
  }
  return out;
}

export type ShiftsLoad =
  | { available: true; shifts: ShiftRow[] }
  | { available: false; shifts: [] };

export async function loadShifts(
  supabase: SupabaseClient,
  companyId: string
): Promise<ShiftsLoad> {
  try {
    const { data, error } = await supabase
      .from("restaurant_shifts")
      .select(
        "id, restaurant_id, name, start_time, end_time, weekdays, active, sort_order"
      )
      .eq("company_id", companyId)
      .order("sort_order", { ascending: true })
      .limit(500);
    if (error) return { available: false, shifts: [] };
    return { available: true, shifts: parseShiftRows(data) };
  } catch {
    return { available: false, shifts: [] };
  }
}

export async function loadBusinessDayConfig(
  supabase: SupabaseClient,
  companyId: string
): Promise<BusinessDayConfig> {
  const loaded = await loadShifts(supabase, companyId);
  if (!loaded.available) return NO_BUSINESS_DAY;
  try {
    const { data } = await supabase
      .from("restaurant_locations")
      .select("id")
      .eq("company_id", companyId)
      .limit(500);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    return buildBusinessDayConfig(loaded.shifts, ids);
  } catch {
    return buildBusinessDayConfig(loaded.shifts, [
      ...new Set(loaded.shifts.map((s) => s.restaurant_id)),
    ]);
  }
}
