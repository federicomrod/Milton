// lib/restaurant/sales-detail-server.ts
//
// R1-17b: loads what Ventas › Detalle needs in ONE read: the cube of the
// restaurant in view (or all), the goals, the restaurants and which shifts
// exist. Everything after this is computed in the browser.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildDetailCube,
  type DetailCube,
} from "@/lib/restaurant/sales-detail-cube";
import { loadBusinessDayConfig } from "@/lib/restaurant/business-day-server";
import { activeShiftCount } from "@/lib/restaurant/business-day";
import { loadTargetsConfig } from "@/lib/restaurant/supabase-targets";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import type { TargetRow } from "@/lib/restaurant/objetivos";

export interface SalesDetailPayload {
  cube: DetailCube;
  targets: TargetRow[];
  restaurants: Array<{ id: string; name: string }>;
  locationId: string | null;
  currency: string;
  timezone: string;
  /** ≥ 2 active shifts in view: shift cards, the Turno filter and dimension. */
  shiftsVisible: boolean;
  /** No restaurant in view has any active shift: the page invites to define them. */
  noShifts: boolean;
  /** Migration 054 applied. */
  shiftsAvailable: boolean;
  /** Shift name → "11:00–17:00" when ONE restaurant is in view (else empty). */
  shiftHours: Record<string, string>;
}

export async function loadSalesDetail(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string | null,
  options: {
    /** Throw on a failed read of the sales rows (a cache must never keep a half-empty cube). */
    failOnReadError?: boolean;
  } = {}
): Promise<SalesDetailPayload> {
  const [timezone, currency, rowsRes, config, targets, locs] =
    await Promise.all([
      resolvePosTimezone(supabase, companyId),
      resolveCompanyCurrency(supabase, companyId),
      fetchCompanyPosSalesRows(supabase as never, companyId, locationId),
      loadBusinessDayConfig(supabase, companyId),
      loadTargetsConfig(supabase, companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true }),
    ]);
  if (options.failOnReadError && rowsRes.error) {
    throw new Error(`sales rows: ${rowsRes.error.message ?? "read failed"}`);
  }
  const restaurants = (
    (locs.data ?? []) as Array<{ id: string; name: string }>
  ).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const cube = buildDetailCube(rowsRes.rows as never, {
    timezone,
    currency,
    config,
  });
  const inView = locationId ? [locationId] : restaurants.map((r) => r.id);
  const counts = inView.map((id) =>
    activeShiftCount([...(config.shiftsByLocation.get(id) ?? [])])
  );
  const hours: Record<string, string> = {};
  const single =
    locationId ?? (restaurants.length === 1 ? restaurants[0].id : null);
  if (single) {
    for (const sh of config.shiftsByLocation.get(single) ?? []) {
      if (sh.active) hours[sh.name] = `${sh.start_time}–${sh.end_time}`;
    }
  }
  return {
    shiftHours: hours,
    cube,
    targets: targets.rows,
    restaurants,
    locationId,
    currency,
    timezone,
    shiftsVisible: counts.some((c) => c >= 2),
    noShifts: config.available && counts.every((c) => c === 0),
    shiftsAvailable: config.available,
  };
}
