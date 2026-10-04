// lib/restaurant/data-connection.ts
//
// "Does this Milton account already have a data connection?" — decides
// where an invited user lands after activation / login (R1 item 2).
//
// A company has a data connection when it has at least one ACTIVE
// restaurant_pos_connections row (any pos_source; an Odoo row counts even
// before an Odoo company is selected — item 1 handles that with its own
// 409) OR at least one pos_sales_items row from a previous import.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DataConnectionStatus {
  activePosConnections: number;
  posSalesCount: number;
}

/** Pure. */
export function hasDataConnection(status: DataConnectionStatus): boolean {
  return status.activePosConnections > 0 || status.posSalesCount > 0;
}

/** Throws on a query error; callers decide how to fall back. */
export async function getDataConnectionStatus(
  supabase: SupabaseClient,
  companyId: string
): Promise<DataConnectionStatus> {
  const [conns, sales] = await Promise.all([
    supabase
      .from("restaurant_pos_connections")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("is_active", true),
    supabase
      .from("pos_sales_items")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId),
  ]);
  if (conns.error) throw new Error("connection status lookup failed");
  if (sales.error) throw new Error("sales count lookup failed");
  return {
    activePosConnections: conns.count ?? 0,
    posSalesCount: sales.count ?? 0,
  };
}
