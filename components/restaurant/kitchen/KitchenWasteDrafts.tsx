// components/restaurant/kitchen/KitchenWasteDrafts.tsx
//
// #408 · Cocina: the waste lines Milton drafted from kitchen reports, for a
// manager to confirm or edit INLINE (quantity, unit, ingredient, then one
// click). Only owner, admin and manager get this (the page does not render it
// for anyone else). No price or value is shown here; a draft counts for
// nothing until it is confirmed. If the table (077) is not there it renders
// nothing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { KitchenWasteDraftsList } from "./KitchenWasteDraftsList";

export interface WasteDraftRow {
  id: string;
  item_name: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit: string | null;
  report_date: string;
}

export async function KitchenWasteDrafts({
  supabase,
  companyId,
  locationId,
}: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string | null;
}) {
  let rows: WasteDraftRow[] = [];
  let ingredients: Array<{ id: string; name: string }> = [];
  try {
    let q = supabase
      .from("kitchen_waste_lines")
      .select("id, item_name, ingredient_id, quantity, unit, report_date")
      .eq("company_id", companyId)
      .eq("status", "draft")
      .order("report_date", { ascending: false })
      .limit(50);
    if (locationId) q = q.eq("location_id", locationId);
    const { data, error } = await q;
    if (error) return null; // migration 077 not applied yet
    rows = ((data ?? []) as WasteDraftRow[]).map((r) => ({
      ...r,
      quantity: r.quantity === null ? null : Number(r.quantity),
    }));
    if (!rows.length) return null;
    const ing = await supabase
      .from("ingredients")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true })
      .limit(2000);
    ingredients = (ing.data ?? []) as typeof ingredients;
  } catch {
    return null;
  }
  return <KitchenWasteDraftsList rows={rows} ingredients={ingredients} />;
}
