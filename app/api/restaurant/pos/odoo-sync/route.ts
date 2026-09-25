// app/api/restaurant/pos/odoo-sync/route.ts
//
// Manual Odoo 18 POS sales sync: authenticate, pull completed orders for a
// requested date range, transform to canonical pos_sales_items rows,
// upsert idempotently.
//
// Odoo Production Hardening v1: the Odoo API key is per-company, loaded
// and decrypted server-side from restaurant_pos_secrets via
// lib/restaurant/odoo/secrets.ts (service-role client, AES-256-GCM at
// rest) — NOT a shared global environment variable. Non-secret connection
// details (base URL, database, username, timezone) still come from
// restaurant_pos_connections, scoped to the authenticated user's company
// via the same RLS-backed client every other restaurant route uses.
//
// This route does not run on a schedule; it is triggered explicitly by an
// authenticated request with a date range. No cron, no background job.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { buildNameIndex } from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";
import {
  authenticate,
  executeKw,
  OdooAuthenticationError,
  OdooRpcError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import {
  transformOdooOrders,
  normalizeMatchKey,
  ODOO_COMPLETED_STATES,
  type OdooPosOrderRaw,
  type OdooPosOrderLineRaw,
  type CanonicalOdooSaleRow,
} from "@/lib/restaurant/odoo/sync";
import { loadDecryptedOdooSecret } from "@/lib/restaurant/odoo/secrets";
import type { RestaurantPosConnection } from "@/types/restaurant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSERT_BATCH_SIZE = 500;
const MAX_RANGE_DAYS = 92; // ~3 months — a generous but bounded manual sync window
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Query Odoo with the requested local range padded by a full day on each
// side, then filter transformed rows back down to the exact requested
// local range afterward. This sidesteps computing exact UTC offset
// boundaries for the timezone (DST-safe) at the cost of a harmless amount
// of over-fetching; the idempotent upsert makes any overlap with a prior
// sync a no-op.
const QUERY_PAD_DAYS = 1;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface RequestBody {
  start_date?: string;
  end_date?: string;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    // --- Parse + validate the requested range ---------------------------
    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return NextResponse.json(
        { error: "Request body must be JSON with start_date and end_date" },
        { status: 400 }
      );
    }
    const { start_date, end_date } = body;
    if (
      !start_date ||
      !end_date ||
      !DATE_RE.test(start_date) ||
      !DATE_RE.test(end_date)
    ) {
      return NextResponse.json(
        { error: "start_date and end_date are required, format YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (start_date > end_date) {
      return NextResponse.json(
        { error: "start_date must be on or before end_date" },
        { status: 400 }
      );
    }
    const rangeDays =
      (new Date(`${end_date}T00:00:00Z`).getTime() -
        new Date(`${start_date}T00:00:00Z`).getTime()) /
        86_400_000 +
      1;
    if (rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        {
          error: `Requested range spans ${rangeDays} days; the manual sync is capped at ${MAX_RANGE_DAYS} days per call`,
        },
        { status: 400 }
      );
    }

    // --- Load non-secret connection config -------------------------------
    const { data: connection, error: connError } = await supabase
      .from("restaurant_pos_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("pos_source", "odoo")
      .eq("is_active", true)
      .maybeSingle();
    if (connError) {
      console.error("[Odoo Sync] connection lookup failed:", connError.message);
      return NextResponse.json(
        {
          error: "Could not look up Odoo connection config",
          details: connError.message,
        },
        { status: 500 }
      );
    }
    if (!connection) {
      return NextResponse.json(
        {
          error: "No active Odoo connection configured for this company",
          message:
            "Add a row to restaurant_pos_connections with pos_source='odoo' and is_active=true before syncing.",
        },
        { status: 404 }
      );
    }
    const conn = connection as RestaurantPosConnection;

    // --- Per-company secret: encrypted at rest, decrypted server-side only.
    // Never logged, never echoed back — see lib/restaurant/odoo/secrets.ts.
    let apiKey: string | null;
    try {
      apiKey = await loadDecryptedOdooSecret(conn.id, companyId);
    } catch (err) {
      // Deliberately generic — never forward err.message here, this is
      // the closest call site to the credential in the whole request.
      console.error(
        "[Odoo Sync] credential lookup failed:",
        err instanceof Error ? err.name : "Unknown error"
      );
      return NextResponse.json(
        { error: "Could not load the stored Odoo credential" },
        { status: 500 }
      );
    }
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "No Odoo credential configured for this company",
          message:
            "Configure this company's Odoo connection (including the API key) via POST /api/restaurant/pos/odoo-connection before syncing.",
        },
        { status: 404 }
      );
    }

    const creds: OdooCredentials = {
      baseUrl: conn.base_url.replace(/\/+$/, ""),
      database: conn.database_name,
      username: conn.username,
      apiKey,
    };

    // --- Authenticate ------------------------------------------------------
    let uid: number;
    try {
      uid = await authenticate(creds);
    } catch (err) {
      if (err instanceof OdooAuthenticationError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Odoo Sync] authentication failed:", message);
      return NextResponse.json(
        { error: "Could not reach Odoo instance", details: message },
        { status: 502 }
      );
    }

    // --- Fetch completed orders in the padded UTC-date window -------------
    const queryStart = addDays(start_date, -QUERY_PAD_DAYS);
    const queryEnd = addDays(end_date, QUERY_PAD_DAYS);
    const domain = [
      ["date_order", ">=", `${queryStart} 00:00:00`],
      ["date_order", "<=", `${queryEnd} 23:59:59`],
      ["state", "in", [...ODOO_COMPLETED_STATES]],
    ];
    const orderFields = [
      "id",
      "state",
      "date_order",
      "pos_reference",
      "uuid",
      "session_id",
      "config_id",
      "currency_id",
    ];

    let orders: OdooPosOrderRaw[];
    try {
      const result = await executeKw(
        creds,
        uid,
        "pos.order",
        "search_read",
        [domain],
        { fields: orderFields }
      );
      orders = (Array.isArray(result)
        ? result
        : []) as unknown as OdooPosOrderRaw[];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Odoo Sync] pos.order search_read failed:", message);
      const status = err instanceof OdooRpcError ? 502 : 500;
      return NextResponse.json(
        { error: "Failed to fetch Odoo POS orders", details: message },
        { status }
      );
    }

    if (orders.length === 0) {
      return NextResponse.json({
        synced_range: { start_date, end_date },
        orders_fetched: 0,
        lines_fetched: 0,
        rows_upserted: 0,
        rows_outside_requested_range_excluded: 0,
        lines_skipped: [],
        unmatched_menu_items: [],
        unmatched_locations: [],
      });
    }

    // --- Fetch lines for those orders --------------------------------------
    const orderIds = orders.map((o) => o.id);
    const lineFields = [
      "id",
      "order_id",
      "product_id",
      "full_product_name",
      "qty",
      "price_unit",
      "price_subtotal",
      "price_subtotal_incl",
      "discount",
      "uuid",
    ];

    let lines: OdooPosOrderLineRaw[];
    try {
      const result = await executeKw(
        creds,
        uid,
        "pos.order.line",
        "search_read",
        [[["order_id", "in", orderIds]]],
        { fields: lineFields }
      );
      lines = (Array.isArray(result)
        ? result
        : []) as unknown as OdooPosOrderLineRaw[];
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[Odoo Sync] pos.order.line search_read failed:", message);
      const status = err instanceof OdooRpcError ? 502 : 500;
      return NextResponse.json(
        { error: "Failed to fetch Odoo POS order lines", details: message },
        { status }
      );
    }

    // --- Build lookup indexes (same soft-match mechanism as Revel) --------
    const [menuItemsRes, locationsRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name, brand_id")
        .eq("company_id", companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name, brand_id")
        .eq("company_id", companyId),
    ]);
    if (menuItemsRes.error) {
      console.error(
        "[Odoo Sync] menu_items lookup failed:",
        menuItemsRes.error.message
      );
    }
    if (locationsRes.error) {
      console.error(
        "[Odoo Sync] restaurant_locations lookup failed:",
        locationsRes.error.message
      );
    }
    const menuItemRows = (menuItemsRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
    }[];
    const locationRows = (locationsRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
    }[];
    // Menu items are matched scoped by brand — never guessed across
    // brands. Uses normalizeMatchKey (from odoo/sync.ts), the same
    // normalization transformOdooOrders uses to look values up.
    const menuItemIndex = buildScopedNameIndex(
      menuItemRows.map((m) => ({
        id: m.id,
        name: m.name,
        scopeId: m.brand_id,
      })),
      normalizeMatchKey
    );
    const locationIndex = buildNameIndex(locationRows);
    const locationBrandIndex = new Map<string, string | null>(
      locationRows.map((l) => [l.id, l.brand_id])
    );

    // --- Transform ----------------------------------------------------------
    const { rows: allRows, skipped } = transformOdooOrders(orders, lines, {
      companyId,
      timezone: conn.timezone,
      defaultCurrency: "MXN",
      menuItemIndex,
      locationIndex,
      locationBrandIndex,
    });

    // Drop rows the padding pulled in that fall outside the exact requested
    // local range.
    const rows = allRows.filter(
      (r) => r.sale_date >= start_date && r.sale_date <= end_date
    );
    const excludedByPadding = allRows.length - rows.length;

    const unmatchedMenuItems = new Set<string>();
    const unmatchedLocations = new Set<string>();
    for (const r of rows) {
      if (!r.menu_item_id) unmatchedMenuItems.add(r.raw_item_name);
    }
    for (const order of orders) {
      if (order.config_id && order.config_id[1]) {
        const key = order.config_id[1];
        const matched = locationIndex.get(
          key.toLowerCase().replace(/[\s_-]+/g, "")
        );
        if (!matched) unmatchedLocations.add(key);
      }
    }

    // --- Upsert (idempotent on company_id, pos_source, external_line_id) --
    let upserted = 0;
    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch: CanonicalOdooSaleRow[] = rows.slice(
        i,
        i + UPSERT_BATCH_SIZE
      );
      const { error: upsertError, count } = await supabase
        .from("pos_sales_items")
        .upsert(batch, {
          onConflict: "company_id,pos_source,external_line_id",
          count: "exact",
        });
      if (upsertError) {
        console.error("[Odoo Sync] upsert failed:", upsertError.message);
        return NextResponse.json(
          {
            error: "Database upsert failed",
            details: upsertError.message,
            rows_upserted_before_failure: upserted,
          },
          { status: 500 }
        );
      }
      upserted += count ?? batch.length;
    }

    return NextResponse.json({
      synced_range: { start_date, end_date },
      odoo_query_range_utc: { start: queryStart, end: queryEnd },
      orders_fetched: orders.length,
      lines_fetched: lines.length,
      rows_upserted: upserted,
      rows_outside_requested_range_excluded: excludedByPadding,
      lines_skipped: skipped,
      unmatched_menu_items: Array.from(unmatchedMenuItems).sort(),
      unmatched_locations: Array.from(unmatchedLocations).sort(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Odoo Sync] Unexpected error:", message);
    return NextResponse.json(
      { error: "Odoo sync failed", details: message },
      { status: 500 }
    );
  }
}
