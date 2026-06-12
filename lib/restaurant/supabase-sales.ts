// lib/restaurant/supabase-sales.ts
//
// Server-only helpers for reading restaurant POS data from Supabase.
//
// Used by app/(restaurant-cockpit)/dashboard/restaurant/page.tsx to render
// live KPIs from `pos_sales_items` when the authenticated user has a company
// and uploaded data, with graceful fallback to mock data otherwise.
//
// Design notes:
// - Pure data layer. No JSX, no React, no formatting.
// - Returns DTOs shaped so they can be fed directly into the existing
//   lib/restaurant/calculations.ts helpers (POSSalesItem-compatible).
// - Mode discrimination is explicit: callers branch on the `mode` field
//   to render "Live POS data" vs "Sample pilot data" badges and copy.
// - Never throws on missing env / missing tables — we want a usable
//   fallback page even in degraded environments.
//
// SECURITY: Reads use the authenticated user's Supabase client, so Row
// Level Security applies. We never bypass RLS or use the service role.
//
// PERFORMANCE: We cap row reads at MAX_ROWS to avoid pulling unbounded
// historical data into the page. For the restaurant pilot the per-month
// row count is small (hundreds, not millions), so this cap is generous.
//
// FUTURE: When per-tenant currency, date filtering, and pagination land,
// extend `fetchRealRestaurantDashboardData` to accept a filter object.
// Until then the page just shows "all rows".
//
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { POSSalesItem } from "@/types/restaurant";

const MAX_ROWS = 10_000;

// ---------------------------------------------------------------------------
// Public DTOs
// ---------------------------------------------------------------------------

export interface DishSalesRow {
  item_name: string;
  units_sold: number;
  revenue: number;
  order_count: number;
  avg_item_price: number;
  /** True iff every sale row for this item has a menu_item_id linked. */
  matched_menu_item: boolean;
}

export interface RealRestaurantOverview {
  total_revenue: number;
  total_orders: number;
  total_units_sold: number;
  avg_ticket: number;
  currency: string;
}

/**
 * Thin row shape passed from the server page to the client explorer.
 * Only fields actually persisted in `pos_sales_items` are exposed — extra
 * derived fields belong in the client component, not here.
 *
 * payment_type / category / sub_category were added by migration
 * 002_add_pos_sales_filter_fields.sql. Rows uploaded before the migration
 * are stored with NULL for these columns; the explorer surfaces those as
 * "Unknown payment type" / "Uncategorized".
 */
export interface ExplorerRow {
  id: string;
  item_name: string;
  quantity: number;
  revenue: number;
  /** Stable order/check identifier, or null if neither column had a value. */
  order_key: string | null;
  /** Normalized sales channel; may be null on legacy rows. */
  sales_channel: string | null;
  /** Free-text payment method from the POS export; null when the upload
   *  predates migration 002 or the source file lacked the column. */
  payment_type: string | null;
  category: string | null;
  sub_category: string | null;
  sale_date: string;
  currency: string;
}

export type RestaurantDashboardData =
  | {
      mode: "live";
      overview: RealRestaurantOverview;
      dishSales: DishSalesRow[];
      /** Raw rows in POSSalesItem-compatible shape, for downstream callers. */
      sales: POSSalesItem[];
      /** Lightweight rows for the client-side explorer. */
      explorerRows: ExplorerRow[];
      companyId: string;
      rowCount: number;
    }
  | {
      mode: "sample";
      /** Why we fell back to sample mode — surfaced in the UI banner. */
      reason: SampleReason;
    };

export type SampleReason =
  | "unauthenticated"
  | "no_company"
  | "no_sales"
  | "supabase_error"
  | "env_missing";

// ---------------------------------------------------------------------------
// We accept the real SupabaseClient type to avoid PostgrestBuilder structural
// incompatibilities with a hand-rolled "minimal" shape. The generic args are
// left at their defaults — we don't have generated database types here yet.
// ---------------------------------------------------------------------------

type SupabaseLike = SupabaseClient;

// ---------------------------------------------------------------------------
// Company resolution — mirrors the fallback chain in
// app/api/restaurant/pos/upload/route.ts so the dashboard sees a company
// for the same set of users that the upload route does.
// ---------------------------------------------------------------------------

export async function resolveCompanyIdForUser(
  supabase: SupabaseLike,
  userId: string
): Promise<string | null> {
  // Step 1 — companies.created_by
  {
    const { data, error } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .maybeSingle();
    if (!error && data?.id) return data.id;
  }

  // Step 2 — profiles.id (Supabase pattern where profiles.id IS auth.uid())
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data?.company_id) return data.company_id;
  }

  // Step 3 — profiles.user_id (older schema variant)
  {
    const { data, error } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data?.company_id) return data.company_id;
  }

  // Step 4 — company_memberships.user_id
  {
    const { data, error } = await supabase
      .from("company_memberships")
      .select("company_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data?.company_id) return data.company_id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Row shape we read from Supabase. We only select the columns we use to
// keep the network payload small and avoid surprises if extra columns are
// added later.
// ---------------------------------------------------------------------------

interface PosSalesItemRow {
  id: string;
  company_id: string;
  location_id: string | null;
  menu_item_id: string | null;
  sale_date: string;
  order_id: string | null;
  check_id: string | null;
  raw_item_name: string | null;
  quantity: number | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  currency: string | null;
  sales_channel: string | null;
  // Added by migration 002_add_pos_sales_filter_fields.sql. Older rows are
  // NULL until the source file is re-uploaded against the new mapping.
  payment_type: string | null;
  category: string | null;
  sub_category: string | null;
}

const POS_SELECT_COLS =
  "id, company_id, location_id, menu_item_id, sale_date, order_id, check_id, raw_item_name, quantity, gross_revenue, net_revenue, currency, sales_channel, payment_type, category, sub_category";

// ---------------------------------------------------------------------------
// Conversion: pos_sales_items row → POSSalesItem (the type the existing
// calculation helpers expect). We map check_id to whichever order key is
// present so deterministic order counting still works.
// ---------------------------------------------------------------------------

function toPOSSalesItem(row: PosSalesItemRow): POSSalesItem {
  // Prefer gross_revenue for "revenue" since that's what the Revel exports
  // surface; if missing, fall back to net_revenue, then 0.
  const total =
    typeof row.gross_revenue === "number" && Number.isFinite(row.gross_revenue)
      ? row.gross_revenue
      : typeof row.net_revenue === "number" && Number.isFinite(row.net_revenue)
        ? row.net_revenue
        : 0;
  const qty =
    typeof row.quantity === "number" && Number.isFinite(row.quantity)
      ? row.quantity
      : 0;
  // Order identity: prefer check_id, fall back to order_id. Both come from
  // the same column in the Revel item-level export per pos-import.ts.
  const orderKey = row.check_id ?? row.order_id ?? undefined;
  return {
    id: row.id,
    company_id: row.company_id,
    location_id: row.location_id ?? "",
    menu_item_id: row.menu_item_id ?? "",
    check_id: orderKey,
    sale_date: row.sale_date,
    quantity: qty,
    unit_price: qty > 0 ? total / qty : 0,
    total_revenue: total,
    currency: row.currency ?? "USD",
    // sales_channel uses a wider vocabulary (in_store/takeaway/delivery/online)
    // than POSSalesItem.channel ("dine_in"/...). We narrow conservatively;
    // unknown values are left undefined.
    channel:
      row.sales_channel === "in_store"
        ? "dine_in"
        : row.sales_channel === "takeaway"
          ? "takeaway"
          : row.sales_channel === "delivery"
            ? "delivery"
            : row.sales_channel === "online"
              ? "online"
              : undefined,
  };
}

// ---------------------------------------------------------------------------
// Aggregations
// ---------------------------------------------------------------------------

/**
 * Deterministic overview metrics from raw POS rows.
 *
 * - total_revenue = Σ gross_revenue (with net_revenue fallback per row, see toPOSSalesItem)
 * - total_orders  = unique non-empty check_id/order_id values
 * - total_units_sold = Σ quantity
 * - avg_ticket    = total_revenue / total_orders (0 when there are no orders)
 *
 * The function is fed normalized POSSalesItem rows so it stays unit-testable.
 */
export function computeOverviewFromRows(
  rows: POSSalesItem[]
): RealRestaurantOverview {
  let totalRevenue = 0;
  let totalUnitsSold = 0;
  const orderIds = new Set<string>();

  for (const r of rows) {
    totalRevenue += r.total_revenue;
    totalUnitsSold += r.quantity;
    if (r.check_id) orderIds.add(r.check_id);
  }

  const totalOrders = orderIds.size;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const currency = rows.length > 0 ? (rows[0].currency ?? "USD") : "USD";

  return {
    total_revenue: totalRevenue,
    total_orders: totalOrders,
    total_units_sold: totalUnitsSold,
    avg_ticket: avgTicket,
    currency,
  };
}

/**
 * Group rows by raw_item_name to produce a per-dish breakdown.
 *
 * Order count for a dish = number of distinct order/check IDs that
 * contained at least one row of that dish.
 */
export function computeDishSales(rawRows: PosSalesItemRow[]): DishSalesRow[] {
  type Bucket = {
    item_name: string;
    units_sold: number;
    revenue: number;
    orderIds: Set<string>;
    allMatched: boolean;
    seenAny: boolean;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rawRows) {
    const name = (r.raw_item_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    let b = buckets.get(key);
    if (!b) {
      b = {
        item_name: name,
        units_sold: 0,
        revenue: 0,
        orderIds: new Set<string>(),
        allMatched: true,
        seenAny: false,
      };
      buckets.set(key, b);
    }
    const qty =
      typeof r.quantity === "number" && Number.isFinite(r.quantity)
        ? r.quantity
        : 0;
    const rev =
      typeof r.gross_revenue === "number" && Number.isFinite(r.gross_revenue)
        ? r.gross_revenue
        : typeof r.net_revenue === "number" && Number.isFinite(r.net_revenue)
          ? r.net_revenue
          : 0;
    b.units_sold += qty;
    b.revenue += rev;
    const orderKey = r.check_id ?? r.order_id ?? null;
    if (orderKey) b.orderIds.add(orderKey);
    b.seenAny = true;
    if (!r.menu_item_id) b.allMatched = false;
  }

  return Array.from(buckets.values())
    .map<DishSalesRow>((b) => ({
      item_name: b.item_name,
      units_sold: b.units_sold,
      revenue: b.revenue,
      order_count: b.orderIds.size,
      avg_item_price: b.units_sold > 0 ? b.revenue / b.units_sold : 0,
      matched_menu_item: b.seenAny && b.allMatched,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

// ---------------------------------------------------------------------------
// Top-level: load everything the dashboard needs, with sample-mode fallback.
// ---------------------------------------------------------------------------

/**
 * Reads all data the restaurant cockpit needs from Supabase. Never throws —
 * returns a sample-mode result with a reason string when the live path is
 * not available.
 */
export async function fetchRealRestaurantDashboardData(
  supabase: SupabaseLike
): Promise<RestaurantDashboardData> {
  // 1. Auth.
  let userId: string;
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) {
      return { mode: "sample", reason: "unauthenticated" };
    }
    userId = data.user.id;
  } catch (err) {
    console.error("[supabase-sales] auth.getUser failed:", err);
    return { mode: "sample", reason: "supabase_error" };
  }

  // 2. Resolve company.
  let companyId: string | null;
  try {
    companyId = await resolveCompanyIdForUser(supabase, userId);
  } catch (err) {
    console.error("[supabase-sales] resolveCompanyIdForUser failed:", err);
    return { mode: "sample", reason: "supabase_error" };
  }
  if (!companyId) {
    return { mode: "sample", reason: "no_company" };
  }

  // 3. Fetch sales rows.
  let rawRows: PosSalesItemRow[];
  try {
    const { data, error } = await supabase
      .from("pos_sales_items")
      .select(POS_SELECT_COLS)
      .eq("company_id", companyId)
      .limit(MAX_ROWS);
    if (error) {
      console.error("[supabase-sales] pos_sales_items read failed:", error);
      return { mode: "sample", reason: "supabase_error" };
    }
    rawRows = (data ?? []) as PosSalesItemRow[];
  } catch (err) {
    console.error("[supabase-sales] pos_sales_items read threw:", err);
    return { mode: "sample", reason: "supabase_error" };
  }

  if (rawRows.length === 0) {
    return { mode: "sample", reason: "no_sales" };
  }

  // 4. Normalize and aggregate.
  const sales = rawRows.map(toPOSSalesItem);
  const overview = computeOverviewFromRows(sales);
  const dishSales = computeDishSales(rawRows);
  const explorerRows = rawRows.map(toExplorerRow);

  return {
    mode: "live",
    overview,
    dishSales,
    sales,
    explorerRows,
    companyId,
    rowCount: rawRows.length,
  };
}

/**
 * Maps a raw `pos_sales_items` row to the slim `ExplorerRow` shape that the
 * client-side explorer renders against. Numeric coercion mirrors the rules
 * used by `toPOSSalesItem` so totals on the page agree row-for-row.
 */
function toExplorerRow(row: PosSalesItemRow): ExplorerRow {
  const qty =
    typeof row.quantity === "number" && Number.isFinite(row.quantity)
      ? row.quantity
      : 0;
  const revenue =
    typeof row.gross_revenue === "number" && Number.isFinite(row.gross_revenue)
      ? row.gross_revenue
      : typeof row.net_revenue === "number" && Number.isFinite(row.net_revenue)
        ? row.net_revenue
        : 0;
  return {
    id: row.id,
    item_name: (row.raw_item_name ?? "").trim(),
    quantity: qty,
    revenue,
    order_key: row.check_id ?? row.order_id ?? null,
    sales_channel: row.sales_channel ?? null,
    // Trim defensively: in the DB these are stored already trimmed (see
    // optionalText() in pos-import.ts), but legacy rows may exist.
    payment_type: trimOrNull(row.payment_type),
    category: trimOrNull(row.category),
    sub_category: trimOrNull(row.sub_category),
    sale_date: row.sale_date,
    currency: row.currency ?? "USD",
  };
}

/** Returns the trimmed string or null when the input is null/empty. */
function trimOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
