// components/restaurant/kitchen/KitchenWasteDrafts.tsx
//
// #408 · Cocina: the waste lines Milton drafted from kitchen reports, for a
// manager to confirm or edit INLINE (quantity, unit, ingredient, then one
// click), plus a short history: confirmed lines (valued at the purchase price,
// or «Sin costo» with their quantity) and drafts older than 7 days («Vencido»,
// never counted, still confirmable by hand). Only owner, admin and manager get
// this (the page does not render it for anyone else). If the table (077) is not
// there it renders nothing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { historySince, isExpiredDraft } from "@/lib/restaurant/unplanned-waste";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import { KitchenWasteDraftsList } from "./KitchenWasteDraftsList";

export interface WasteLineRow {
  id: string;
  item_name: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit: string | null;
  report_date: string;
  status: "draft" | "confirmed";
  value: number | null;
  /** A draft older than 7 days: «Vencido». */
  expired: boolean;
}

const HISTORY_DAYS = 30;

export async function KitchenWasteDrafts({
  supabase,
  companyId,
  locationId,
}: {
  supabase: SupabaseClient;
  companyId: string;
  locationId: string | null;
}) {
  let rows: WasteLineRow[] = [];
  let ingredients: Array<{ id: string; name: string }> = [];
  let currency = "USD";
  try {
    const since = historySince(HISTORY_DAYS);
    let q = supabase
      .from("kitchen_waste_lines")
      .select(
        "id, item_name, ingredient_id, quantity, unit, report_date, status, value, created_at"
      )
      .eq("company_id", companyId)
      .or(`status.eq.draft,report_date.gte.${since}`)
      .order("report_date", { ascending: false })
      .limit(100);
    if (locationId) q = q.eq("location_id", locationId);
    const { data, error } = await q;
    if (error) return null; // migration 077 not applied yet
    rows = (
      (data ?? []) as Array<
        Omit<WasteLineRow, "expired"> & { created_at: string }
      >
    ).map((r) => ({
      id: r.id,
      item_name: r.item_name,
      ingredient_id: r.ingredient_id,
      quantity: r.quantity === null ? null : Number(r.quantity),
      unit: r.unit,
      report_date: r.report_date,
      status: r.status,
      value: r.value === null ? null : Number(r.value),
      expired: r.status === "draft" && isExpiredDraft(r.created_at),
    }));
    if (!rows.length) return null;
    const [ing, cur] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name")
        .eq("company_id", companyId)
        .order("name", { ascending: true })
        .limit(2000),
      resolveCompanyCurrency(supabase, companyId).catch(() => "USD"),
    ]);
    ingredients = (ing.data ?? []) as typeof ingredients;
    currency = cur || "USD";
  } catch {
    return null;
  }
  return (
    <KitchenWasteDraftsList
      rows={rows}
      ingredients={ingredients}
      currency={currency}
    />
  );
}
