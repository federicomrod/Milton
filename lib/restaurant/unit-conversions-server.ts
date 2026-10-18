// lib/restaurant/unit-conversions-server.ts
//
// Per-ingredient unit bridges (migration 056), read for costing. Tolerant:
// before the migration is applied, or on any read error, there are simply no
// conversions (lines stay «Unidad distinta»; nothing is guessed).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitConversion } from "@/lib/restaurant/units";

export type UnitConversionRow = UnitConversion & {
  id: string;
  ingredient_id: string;
};

export function groupConversions(
  rows: ReadonlyArray<UnitConversionRow>
): Map<string, UnitConversion[]> {
  const out = new Map<string, UnitConversion[]>();
  for (const r of rows) {
    const factor = Number(r.factor);
    if (!(factor > 0) || !Number.isFinite(factor)) continue;
    const list = out.get(r.ingredient_id) ?? [];
    list.push({ from_unit: r.from_unit, to_unit: r.to_unit, factor });
    out.set(r.ingredient_id, list);
  }
  return out;
}

export async function loadUnitConversions(
  supabase: SupabaseClient,
  companyId: string
): Promise<Map<string, UnitConversion[]>> {
  try {
    const { data, error } = await supabase
      .from("ingredient_unit_conversions")
      .select("id, ingredient_id, from_unit, to_unit, factor")
      .eq("company_id", companyId)
      .limit(10000);
    if (error) return new Map();
    return groupConversions((data ?? []) as UnitConversionRow[]);
  } catch {
    return new Map();
  }
}
