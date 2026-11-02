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

/** Confirmed waste of one restaurant between two dates (inclusive). */
export async function loadWasteSummary(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  from: string,
  to: string
): Promise<WasteMonth> {
  try {
    const { data, error } = await supabase
      .from("kitchen_waste_lines")
      .select("status, value")
      .eq("company_id", companyId)
      .eq("location_id", locationId)
      .gte("report_date", from)
      .lte("report_date", to)
      .limit(20000);
    if (error) return { available: false };
    const rows = (data ?? []) as Array<{
      status: "draft" | "confirmed";
      value: number | string | null;
    }>;
    return {
      available: true,
      summary: summarizeWaste(
        rows.map((r) => ({
          status: r.status,
          value: r.value === null ? null : Number(r.value),
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
 * confirmed reports lost. Null when it cannot be read or there are no purchases.
 */
export async function loadPlanVsReported(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  from: string,
  to: string,
  reported: number
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
    return planVsReported({ purchases, planned, reported });
  } catch {
    return null;
  }
}

/** The price of an ingredient on a day, and its effective-cost factors that day. */
export async function valueIngredientWaste(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string,
  ingredientId: string,
  date: string,
  quantity: number | null,
  unit: string | null
): Promise<{ unitCost: number; value: number } | null> {
  const [entries, yields, buffer] = await Promise.all([
    supabase
      .from("ingredient_cost_entries")
      .select(
        "ingredient_id, effective_date, cost_date, created_at, normalized_unit_cost, normalized_unit, unit_cost, source_type"
      )
      .eq("company_id", companyId)
      .eq("ingredient_id", ingredientId)
      .lte("cost_date", date)
      .limit(500),
    loadYieldsAt(supabase, companyId, [ingredientId], date),
    loadResolvedBufferAt(supabase, companyId, locationId, date),
  ]);
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
    ownLossPct: yields.get(ingredientId)?.lossPct ?? null,
    bufferPct: buffer.bufferPct,
  });
}
