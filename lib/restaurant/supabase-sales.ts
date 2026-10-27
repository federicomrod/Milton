// lib/restaurant/supabase-sales.ts
//
// Server-only helpers for reading restaurant POS data from Supabase.
//
// Used by app/dashboard/restaurant/(cockpit)/page.tsx to render
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
// PERFORMANCE: PostgREST silently caps every response at 1,000 rows
// (`max_rows`). We page with fetchAllRows() so a month of POS lines
// (this client: ~10k/location) is not truncated to ~$7–8k. A safety cap
// far above a pilot year still applies; the UI is told when it is hit.
//
// FUTURE: When per-tenant currency, date filtering, and pagination land,
// extend `fetchRealRestaurantDashboardData` to accept a filter object.
// Until then the page just shows "all rows".
//
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";
import type { POSSalesItem } from "@/types/restaurant";
import { warnIfTruncated } from "@/lib/restaurant/paginated-read";
import { logCockpitTiming } from "@/lib/restaurant/cockpit-timing";
import { resolveCompanyCurrency } from "@/lib/restaurant/currency";
import {
  resolveRestaurantCockpitLanguage,
  type PreferredLanguage,
} from "@/lib/restaurant/language";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import {
  buildCockpitSalesAggregate,
  emptyCockpitSalesAggregate,
  type CockpitSalesAggregate,
} from "@/lib/restaurant/cockpit-aggregates";
import { classifySaleLine, isTipSaleRow } from "@/lib/restaurant/sales-revenue";
import {
  fetchAllRowsRetryingWithoutColumn,
  fetchAllRowsRetryingWithoutColumns,
} from "@/lib/restaurant/missing-schema-column";
import { cutoffFor } from "@/lib/restaurant/business-day";
import { loadBusinessDayConfig } from "@/lib/restaurant/business-day-server";

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
  /** Net sales (tips excluded). Same number as `revenue.net_sales`. */
  total_revenue: number;
  total_orders: number;
  total_units_sold: number;
  avg_ticket: number;
  currency: string;
  gross_sales: number;
  discounts: number;
  net_sales: number;
  tips: number;
  odoo_like_total: number;
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
  /** Tip / Propina line — excluded from net sales KPIs. */
  is_tip: boolean;
  discount_amount: number;
  /** True when discount_amount used the Odoo % fallback. */
  discount_estimated: boolean;
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
      /** True when the paginated read hit the safety cap. */
      truncated: boolean;
      /**
       * Slim POS facts for `fetchProfitabilityData` so the cockpit request
       * does not page `pos_sales_items` a second time.
       */
      posFactRows: PosSalesItemRow[];
      cockpit: CockpitSalesAggregate;
      timezone: string;
      preferredLanguage: PreferredLanguage;
      /**
       * True when the POS read failed after the missing-column retry.
       * Callers must show the warning banner — never invent sample totals.
       */
      readError?: boolean;
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
// Company resolution — same sources as
// app/api/restaurant/pos/upload/route.ts, memberships first. Restaurant
// companies have no created_by (001 / 026); querying it first was a
// failed PostgREST hop on every cockpit load.
// ---------------------------------------------------------------------------

export async function resolveCompanyIdForUser(
  supabase: SupabaseLike,
  userId: string
): Promise<string | null> {
  // Restaurant schema has no companies.created_by (001 / 026). Hitting that
  // column first costs a failed PostgREST round trip on every cockpit load.
  // Memberships is the real owner path; keep created_by last for legacy.
  // A user can belong to several companies (.maybeSingle() errors on 2+ rows
  // and used to drop us into the profile fallback, i.e. maybe a company the
  // user has no membership in). With memberships the answer is always one of
  // them: the only one; else profiles.company_id when it is one of them; else
  // the oldest (created_at, then company_id) so it never flips between calls.
  // Without any membership (Milton staff, legacy) the fallbacks below apply.
  {
    const { data, error } = await supabase
      .from("company_memberships")
      .select("company_id, created_at")
      .eq("user_id", userId);
    const memberships = (
      (!error && Array.isArray(data) ? data : []) as {
        company_id: string | null;
        created_at?: string | null;
      }[]
    ).filter((m) => !!m.company_id);
    if (memberships.length === 1) return memberships[0].company_id as string;
    if (memberships.length > 1) {
      const ids = new Set(memberships.map((m) => m.company_id as string));
      for (const column of ["id", "user_id"]) {
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("company_id")
          .eq(column, userId)
          .maybeSingle();
        const preferred = profile?.company_id as string | null | undefined;
        if (!profileError && preferred && ids.has(preferred)) return preferred;
      }
      const oldest = [...memberships].sort(
        (a, b) =>
          String(a.created_at ?? "").localeCompare(
            String(b.created_at ?? "")
          ) || String(a.company_id).localeCompare(String(b.company_id))
      )[0];
      return oldest.company_id as string;
    }
  }

  {
    const { data, error } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (!error && data?.company_id) return data.company_id;
  }

  {
    const { data, error } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!error && data?.company_id) return data.company_id;
  }

  {
    const { data, error } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .maybeSingle();
    if (!error && data?.id) return data.id;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Row shape we read from Supabase. We only select the columns we use to
// keep the network payload small and avoid surprises if extra columns are
// added later.
// ---------------------------------------------------------------------------

export interface PosSalesItemRow {
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
  /** Precise source timestamp when present (migration 012). */
  order_placed_at?: string | null;
  discount_amount?: number | null;
  /** Migration 030. Null on legacy rows — readers use the product name. */
  is_tip?: boolean | null;
  source_metadata?: { discount_estimated?: boolean } | null;
  /** Only read with `withComboLines`: the source line id. */
  external_line_id?: string | null;
  /** Migration 038, only with `withComboLines`: the combo line this is part of. */
  combo_parent_external_line_id?: string | null;
  combo_parent_odoo_product_id?: number | null;
  /** R1-17a: business-day cutoff of this line's restaurant (set on read). */
  business_cutoff_min?: number | null;
}

const POS_SELECT_COLS =
  "id, company_id, location_id, menu_item_id, sale_date, order_id, check_id, raw_item_name, quantity, gross_revenue, net_revenue, discount_amount, currency, sales_channel, payment_type, category, sub_category, order_placed_at, is_tip, source_metadata";

/** Line id + combo-parent link (038). Optional on older schemas. */
const POS_COMBO_COLS =
  "external_line_id, combo_parent_external_line_id, combo_parent_odoo_product_id";
const POS_COMBO_OPTIONAL_COLS = [
  "combo_parent_external_line_id",
  "combo_parent_odoo_product_id",
  "is_tip",
] as const;

// ---------------------------------------------------------------------------
// Conversion: pos_sales_items row → POSSalesItem (the type the existing
// calculation helpers expect). We map check_id to whichever order key is
// present so deterministic order counting still works.
// ---------------------------------------------------------------------------

function toPOSSalesItem(row: PosSalesItemRow): POSSalesItem {
  // Net sales: posted revenue excluding Propina / tip lines.
  const line = classifySaleLine(row);
  const total = line.net;
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
 * - total_revenue / net_sales = Σ posted revenue excluding tips
 * - total_orders  = unique non-empty check_id/order_id values
 * - total_units_sold = Σ quantity of non-tip lines
 * - avg_ticket    = net_sales / total_orders (0 when there are no orders)
 *
 * Prefer `computeOverviewFromPosRows` when the caller still has the raw
 * `pos_sales_items` shape (discounts + tip flag). This helper stays
 * unit-testable from POSSalesItem rows (already netted by toPOSSalesItem).
 */
export function computeOverviewFromRows(
  rows: POSSalesItem[],
  companyCurrency?: string
): RealRestaurantOverview {
  let totalRevenue = 0;
  let totalUnitsSold = 0;
  const orderIds = new Set<string>();

  for (const r of rows) {
    if (companyCurrency && r.currency && r.currency !== companyCurrency) {
      continue;
    }
    totalRevenue += r.total_revenue;
    totalUnitsSold += r.quantity;
    if (r.check_id) orderIds.add(r.check_id);
  }

  const totalOrders = orderIds.size;
  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const currency =
    companyCurrency ?? (rows.length > 0 ? (rows[0].currency ?? "USD") : "USD");

  return {
    total_revenue: totalRevenue,
    total_orders: totalOrders,
    total_units_sold: totalUnitsSold,
    avg_ticket: avgTicket,
    currency,
    gross_sales: totalRevenue,
    discounts: 0,
    net_sales: totalRevenue,
    tips: 0,
    odoo_like_total: totalRevenue,
  };
}

/** Overview from raw POS rows so discounts and tips are visible. */
export function computeOverviewFromPosRows(
  rawRows: PosSalesItemRow[],
  companyCurrency?: string
): RealRestaurantOverview {
  const cockpit = buildCockpitSalesAggregate(rawRows, {
    currency: companyCurrency,
  });
  return {
    total_revenue: cockpit.revenue.net_sales,
    total_orders: cockpit.tickets,
    total_units_sold: cockpit.units,
    avg_ticket: cockpit.avg_ticket,
    currency: cockpit.currency,
    gross_sales: cockpit.revenue.gross_sales,
    discounts: cockpit.revenue.discounts,
    net_sales: cockpit.revenue.net_sales,
    tips: cockpit.revenue.tips,
    odoo_like_total: cockpit.revenue.odoo_like_total,
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
    if (isTipSaleRow(r)) continue;
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

/**
 * Paged `pos_sales_items` read used by the cockpit and Ask Milton.
 * PostgREST caps each response at 1,000 rows — this walks `.range()` via
 * `fetchAllRows` and fail-closes on a mid-loop error (empty rows + error).
 *
 * Multi-Restaurant UX v1: `selectedLocationId` scopes to one restaurant
 * when the caller has already validated it against the company.
 */
export async function fetchCompanyPosSalesRows(
  supabase: SupabaseLike,
  companyId: string,
  selectedLocationId?: string | null,
  /** Only sales on/after this sale_date (YYYY-MM-DD): bounds a morning job's read. */
  options?: {
    sinceDate?: string | null;
    /**
     * Also read each line's id and combo-parent link (migration 038), so a
     * reader can count a combo once instead of once per component. Off by
     * default: other readers keep today's select unchanged.
     */
    withComboLines?: boolean;
  }
) {
  // R1-17a: each line carries the business-day cutoff of its restaurant, so
  // every row walk (daily series, heatmap, shifts) uses the same business day
  // as the SQL rollups. Before migration 054 nothing is attached.
  const [result, businessDay] = await Promise.all([
    fetchPosSalesRowsRaw(
      supabase,
      companyId,
      selectedLocationId,
      options?.sinceDate ?? null,
      options?.withComboLines === true
    ),
    loadBusinessDayConfig(supabase as never, companyId),
  ]);
  if (businessDay.available) {
    for (const row of result.rows) {
      row.business_cutoff_min = cutoffFor(businessDay, row.location_id);
    }
  }
  return result;
}

async function fetchPosSalesRowsRaw(
  supabase: SupabaseLike,
  companyId: string,
  selectedLocationId?: string | null,
  sinceDate?: string | null,
  withComboLines = false
) {
  const makeQuery = (select: string) => {
    let query = supabase
      .from("pos_sales_items")
      .select(select)
      .eq("company_id", companyId);
    if (selectedLocationId) {
      query = query.eq("location_id", selectedLocationId);
    }
    if (sinceDate) query = query.gte("sale_date", sinceDate);
    return query;
  };
  if (withComboLines) {
    return fetchAllRowsRetryingWithoutColumns<PosSalesItemRow>(
      POS_COMBO_OPTIONAL_COLS,
      makeQuery,
      `${POS_SELECT_COLS}, ${POS_COMBO_COLS}`
    );
  }
  return fetchAllRowsRetryingWithoutColumn<PosSalesItemRow>(
    "is_tip",
    makeQuery,
    POS_SELECT_COLS
  );
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
  supabase: SupabaseLike,
  /**
   * Multi-Restaurant UX v1: when set, scopes `pos_sales_items` to a single
   * location (already validated by the caller against the resolved
   * company — see lib/restaurant/restaurant-context-server.ts). null/undefined
   * preserves today's company-wide consolidated behavior.
   */
  selectedLocationId?: string | null
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

  // 3. Fetch sales rows (paged; PostgREST caps each response at 1,000).
  let rawRows: PosSalesItemRow[];
  let truncated = false;
  try {
    const result = await fetchCompanyPosSalesRows(
      supabase,
      companyId,
      selectedLocationId
    );
    if (result.error) {
      console.error(
        "[supabase-sales] pos_sales_items read failed:",
        result.error
      );
      return liveReadError(supabase, companyId);
    }
    warnIfTruncated("supabase-sales pos_sales_items", result);
    rawRows = result.rows;
    truncated = result.truncated;
    logCockpitTiming("pos-rows", {
      pages: result.pages,
      elapsedMs: result.elapsedMs,
      rows: result.rows.length,
      location: selectedLocationId,
    });
  } catch (err) {
    console.error("[supabase-sales] pos_sales_items read threw:", err);
    return liveReadError(supabase, companyId);
  }

  if (rawRows.length === 0) {
    return { mode: "sample", reason: "no_sales" };
  }

  // 4. Normalize and aggregate once (no second POS read).
  const [companyCurrency, timezone, preferredLanguage] = await Promise.all([
    resolveCompanyCurrency(supabase, companyId),
    resolvePosTimezone(supabase, companyId),
    resolveCompanyPreferredLanguage(supabase, companyId),
  ]);
  const cockpit = buildCockpitSalesAggregate(rawRows, {
    timezone,
    currency: companyCurrency,
  });
  const sales = rawRows.map(toPOSSalesItem);
  const overview = computeOverviewFromPosRows(rawRows, companyCurrency);
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
    truncated,
    posFactRows: rawRows,
    cockpit,
    timezone,
    preferredLanguage,
  };
}

async function resolveCompanyPreferredLanguage(
  supabase: SupabaseLike,
  companyId: string
): Promise<PreferredLanguage> {
  try {
    const { data } = await supabase
      .from("companies")
      .select("preferred_language")
      .eq("id", companyId)
      .maybeSingle();
    return resolveRestaurantCockpitLanguage(data?.preferred_language);
  } catch (err) {
    console.error("[supabase-sales] preferred_language lookup:", err);
    return resolveRestaurantCockpitLanguage(null);
  }
}

/**
 * Maps a raw `pos_sales_items` row to the slim `ExplorerRow` shape that the
 * client-side explorer renders against. Numeric coercion mirrors the rules
 * used by `toPOSSalesItem` so totals on the page agree row-for-row.
 */
export function toExplorerRow(row: PosSalesItemRow): ExplorerRow {
  const qty =
    typeof row.quantity === "number" && Number.isFinite(row.quantity)
      ? row.quantity
      : 0;
  const line = classifySaleLine(row);
  return {
    id: row.id,
    item_name: (row.raw_item_name ?? "").trim(),
    quantity: qty,
    revenue: line.posted,
    order_key: row.check_id ?? row.order_id ?? null,
    sales_channel: row.sales_channel ?? null,
    // Trim defensively: in the DB these are stored already trimmed (see
    // optionalText() in pos-import.ts), but legacy rows may exist.
    payment_type: trimOrNull(row.payment_type),
    category: trimOrNull(row.category),
    sub_category: trimOrNull(row.sub_category),
    sale_date: row.sale_date,
    currency: row.currency ?? "USD",
    is_tip: line.isTip,
    discount_amount: line.discount,
    discount_estimated: line.discountEstimated,
  };
}

async function liveReadError(
  supabase: SupabaseLike,
  companyId: string
): Promise<Extract<RestaurantDashboardData, { mode: "live" }>> {
  const [companyCurrency, timezone, preferredLanguage] = await Promise.all([
    resolveCompanyCurrency(supabase, companyId),
    resolvePosTimezone(supabase, companyId),
    resolveCompanyPreferredLanguage(supabase, companyId),
  ]);
  const empty = emptyCockpitSalesAggregate(timezone, companyCurrency);
  return {
    mode: "live",
    readError: true,
    overview: {
      total_revenue: 0,
      total_orders: 0,
      total_units_sold: 0,
      avg_ticket: 0,
      currency: companyCurrency,
      gross_sales: 0,
      discounts: 0,
      net_sales: 0,
      tips: 0,
      odoo_like_total: 0,
    },
    dishSales: [],
    sales: [],
    explorerRows: [],
    companyId,
    rowCount: 0,
    truncated: false,
    posFactRows: [],
    cockpit: empty,
    timezone,
    preferredLanguage,
  };
}

/** Returns the trimmed string or null when the input is null/empty. */
function trimOrNull(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
