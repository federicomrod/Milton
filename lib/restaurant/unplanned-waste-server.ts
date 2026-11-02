// lib/restaurant/unplanned-waste-server.ts
//
// #408 · reads and writes of kitchen_waste_lines (migration 077). Everything
// here survives the table not existing yet: a read answers
// { available: false } (the page shows «⚑ Falta»), a write answers an error,
// nothing throws into a page and nothing is ever valued as $0.

import type { SupabaseClient } from "@supabase/supabase-js";
import { latestCostEntry } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import {
  loadResolvedBufferAt,
  loadYieldsAt,
} from "@/lib/restaurant/yield-buffer";
import {
  plannedWaste,
  planVsReported,
  summarizeWaste,
  valueWasteLine,
  type WastePlanVsReported,
  type WasteSummary,
} from "@/lib/restaurant/unplanned-waste";

export function isMissingTable(
  error: { code?: string; message?: string } | null | undefined
): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    (/kitchen_waste_lines/i.test(error.message ?? "") &&
      /does not exist|schema cache/i.test(error.message ?? ""))
  );
}

export type WasteMonth =
  | { available: false }
  | { available: true; summary: WasteSummary };

/** Waste lines of the given restaurants between two dates (inclusive). */
export async function loadWasteSummary(
  supabase: SupabaseClient,
  companyId: string,
  locationIds: readonly string[],
  from: string,
  to: string
): Promise<WasteMonth> {
  try {
    if (!locationIds.length) return { available: false };
    const { data, error } = await supabase
      .from("kitchen_waste_lines")
      .select("status, value, created_at")
      .eq("company_id", companyId)
      .in("location_id", [...locationIds])
      .gte("report_date", from)
      .lte("report_date", to)
      .limit(20000);
    if (error) return { available: false };
    const rows = (data ?? []) as Array<{
      status: "draft" | "confirmed";
      value: number | string | null;
      created_at?: string;
    }>;
    return {
      available: true,
      summary: summarizeWaste(
        rows.map((r) => ({
          status: r.status,
          value: r.value === null ? null : Number(r.value),
          createdAt: r.created_at,
        }))
      ),
    };
  } catch {
    return { available: false };
  }
}

/**
 * «De lo que compraste»: purchases of the window, the loss they plan for (each
 * ingredient's own yield, else the kitchen buffer, as of `to`) and what the
 * confirmed reports lost. ingredient_cost_entries has no location, so the
 * purchases are company-wide: with several restaurants `reported` must be the
 * waste of ALL of them (`allRestaurants`), and the line says so. Null when it
 * cannot be read or there are no purchases.
 */
export async function loadPlanVsReported(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  from: string,
  to: string,
  reported: number,
  allRestaurants = false
): Promise<WastePlanVsReported | null> {
  try {
    const { data, error } = await supabase
      .from("ingredient_cost_entries")
      .select("ingredient_id, total_cost, effective_date, cost_date")
      .eq("company_id", companyId)
      .gte("cost_date", from)
      .lte("cost_date", to)
      .limit(20000);
    if (error) return null;
    const rows = (data ?? []) as Array<{
      ingredient_id: string;
      total_cost: number | string | null;
    }>;
    const buys = rows
      .map((r) => ({ id: r.ingredient_id, cost: Number(r.total_cost) }))
      .filter((r) => Number.isFinite(r.cost) && r.cost > 0);
    const purchases = buys.reduce((s, b) => s + b.cost, 0);
    if (purchases <= 0) return null;
    const [yields, buffer] = await Promise.all([
      loadYieldsAt(
        supabase,
        companyId,
        [...new Set(buys.map((b) => b.id))],
        to
      ),
      loadResolvedBufferAt(supabase, companyId, locationId, to),
    ]);
    const planned = plannedWaste(
      buys.map((b) => ({
        cost: b.cost,
        lossPct: yields.get(b.id)?.lossPct ?? buffer.bufferPct,
      }))
    );
    return planVsReported({ purchases, planned, reported, allRestaurants });
  } catch {
    return null;
  }
}

/**
 * The purchase price of an ingredient on a day (the newest entry in force that
 * day), per as-bought unit, times the quantity. No yield or buffer: the merma
 * is already in the dish cost. Null = «Sin costo».
 */
export async function valueIngredientWaste(
  supabase: SupabaseClient,
  companyId: string,
  ingredientId: string,
  date: string,
  quantity: number | null,
  unit: string | null
): Promise<{ unitCost: number; value: number } | null> {
  // Newest first BEFORE the limit, and an entry counts by its effective date
  // (the cost date only when it has none), as latestCostEntry reads it.
  const entries = await supabase
    .from("ingredient_cost_entries")
    .select(
      "ingredient_id, effective_date, cost_date, created_at, normalized_unit_cost, normalized_unit, unit_cost, source_type"
    )
    .eq("company_id", companyId)
    .eq("ingredient_id", ingredientId)
    .or(
      `effective_date.lte.${date},and(effective_date.is.null,cost_date.lte.${date})`
    )
    .order("effective_date", { ascending: false, nullsFirst: false })
    .order("cost_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  if (entries.error) return null;
  const entry = latestCostEntry(
    (entries.data ?? []) as unknown as IngredientCostEntry[],
    date
  );
  if (!entry) return null;
  return valueWasteLine({
    quantity,
    unit,
    price: Number(entry.normalized_unit_cost),
    priceUnit: entry.normalized_unit,
  });
}
