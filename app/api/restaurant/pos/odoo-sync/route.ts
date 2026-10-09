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
// Odoo multi-company isolation: every Odoo model call goes through
// scopedExecuteKw() (lib/restaurant/odoo/scoped.ts), which injects a
// company_id domain filter AND context.allowed_company_ids for the Odoo
// companies selected on the connection (odoo_company_ids). Nothing is
// selected -> 409, before the secret is decrypted or Odoo is contacted.
// The stored selection is re-validated against Odoo on every run, and
// every fetched record's company_id is re-checked before anything is
// upserted. A single foreign record aborts the whole sync (no partial
// upsert).
//
// This route does not run on a schedule; it is triggered explicitly by an
// authenticated request with a date range. No cron, no background job.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { buildNameIndex } from "@/lib/restaurant/pos-import";
import { buildScopedNameIndex } from "@/lib/restaurant/scoped-matching";
import {
  authenticate,
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
} from "@/lib/restaurant/odoo/sync";
import {
  loadOdooDimensions,
  optionalOrderFields,
  stripFailedDimensionFields,
  type ScopedOdooCall,
} from "@/lib/restaurant/odoo/dimension-fetch";
import {
  QUERY_PAD_DAYS,
  addDays,
  parseInclusiveDateRange,
} from "@/lib/restaurant/odoo/sync-window";
import { loadDecryptedOdooSecret } from "@/lib/restaurant/odoo/secrets";
import {
  assertOdooScope,
  assertRecordsInScope,
  discoverOdooCompanies,
  scopedExecuteKw,
  OdooCompanyScopeError,
  type OdooScope,
} from "@/lib/restaurant/odoo/scoped";
import type { RestaurantPosConnection } from "@/types/restaurant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UPSERT_BATCH_SIZE = 500;

// Query Odoo with the requested local range padded by a full day on each
// side, then filter transformed rows back down to the exact requested
// local range afterward. This sidesteps computing exact UTC offset
// boundaries for the timezone (DST-safe) at the cost of a harmless amount
// of over-fetching; the idempotent upsert makes any overlap with a prior
// sync a no-op. Re-sync of the same range updates dimension columns on
// existing (company_id, pos_source, external_line_id) rows.

/** Log name + message server-side; never put err.message in the JSON body. */
function logOdooFault(tag: string, err: unknown): string {
  const name = err instanceof Error ? err.name : "UnknownError";
  const logMessage = err instanceof Error ? err.message : "Unknown error";
  let statusClass = "unknown";
  if (err instanceof OdooRpcError && typeof err.faultCode === "number") {
    const code = err.faultCode;
    if (Number.isInteger(code) && code >= 100 && code <= 599) {
      statusClass = `${Math.floor(code / 100)}xx`;
    }
  }
  console.error(tag, name, logMessage);
  return statusClass;
}

function odooFaultDetails(statusClass: string): string {
  return `Odoo request failed (${statusClass})`;
}

// Generic on purpose: nothing about the offending records leaves the server.
function scopeViolationResponse(err: unknown): NextResponse {
  const statusClass = logOdooFault(
    "[Odoo Sync] aborted, scope check failed:",
    err
  );
  return NextResponse.json(
    {
      error: "Odoo returned data outside the selected companies; sync aborted",
      details: odooFaultDetails(statusClass),
    },
    { status: 502 }
  );
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
    const range = parseInclusiveDateRange(body.start_date, body.end_date);
    if (!range.ok) {
      return NextResponse.json({ error: range.error }, { status: 400 });
    }
    const { start_date, end_date } = range;

    // --- Load non-secret connection config -------------------------------
    const { data: connection, error: connError } = await supabase
      .from("restaurant_pos_connections")
      .select("*")
      .eq("company_id", companyId)
      .eq("pos_source", "odoo")
      .eq("is_active", true)
      .maybeSingle();
    if (connError) {
      console.error(
        "[Odoo Sync] connection lookup failed:",
        "PostgrestError",
        connError.message
      );
      return NextResponse.json(
        {
          error: "Could not look up Odoo connection config",
          details: odooFaultDetails("unknown"),
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

    // --- Fail closed: no selected Odoo company, no Odoo call. This runs
    // BEFORE the secret is decrypted and before Odoo is contacted. --------
    let scope: OdooScope;
    try {
      scope = assertOdooScope(conn.odoo_company_ids);
    } catch (err) {
      if (err instanceof OdooCompanyScopeError) {
        return NextResponse.json(
          {
            error: "odoo_company_selection_required",
            message:
              "Choose which Odoo companies this Milton account should sync (GET/POST /api/restaurant/pos/odoo-companies) before syncing.",
          },
          { status: 409 }
        );
      }
      throw err;
    }

    // --- Load restaurant locations to validate mapping BEFORE Odoo fetch ---
    const { data: locationRows, error: locError } = await supabase
      .from("restaurant_locations")
      .select("id, odoo_company_id")
      .eq("company_id", companyId);
    if (locError) {
      console.error(
        "[Odoo Sync] restaurant_locations lookup failed:",
        "PostgrestError",
        locError.message
      );
      return NextResponse.json(
        {
          error: "Could not load restaurant locations",
          details: odooFaultDetails("unknown"),
        },
        { status: 500 }
      );
    }

    // Build Odoo company → location mapping
    const companyLocationMap = new Map<number, string>();
    for (const loc of (locationRows ?? []) as Array<{
      id: string;
      odoo_company_id: number | null;
    }>) {
      if (loc.odoo_company_id !== null) {
        companyLocationMap.set(loc.odoo_company_id, loc.id);
      }
    }

    // Fail closed: all selected companies must be mapped
    const unmappedCompanies = scope.companyIds.filter(
      (id) => !companyLocationMap.has(id)
    );
    if (unmappedCompanies.length > 0) {
      return NextResponse.json(
        {
          error: "odoo_location_mapping_required",
          unmapped_companies: unmappedCompanies,
          message: `Odoo companies ${unmappedCompanies.join(", ")} are not mapped to locations. Map them in the admin Odoo page before syncing.`,
        },
        { status: 409 }
      );
    }

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
      const statusClass = logOdooFault(
        "[Odoo Sync] authentication failed:",
        err
      );
      return NextResponse.json(
        {
          error: "Could not reach Odoo instance",
          details: odooFaultDetails(statusClass),
        },
        { status: 502 }
      );
    }

    // --- Re-validate the stored selection against Odoo on every sync -----
    // (a tenant member can edit the column under RLS; they must never be
    // able to reach a company the stored Odoo user cannot access).
    try {
      const { companies } = await discoverOdooCompanies(creds, uid);
      const accessibleIds = new Set(companies.map((c) => c.id));
      if (!scope.companyIds.every((id) => accessibleIds.has(id))) {
        return NextResponse.json(
          {
            error: "odoo_company_selection_invalid",
            message:
              "The selected Odoo companies are no longer accessible to the connected Odoo user. Re-select them via /api/restaurant/pos/odoo-companies.",
          },
          { status: 409 }
        );
      }
    } catch (err) {
      const statusClass = logOdooFault(
        "[Odoo Sync] company re-validation failed:",
        err
      );
      return NextResponse.json(
        {
          error: "Could not verify Odoo company access",
          details: odooFaultDetails(statusClass),
        },
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
    const scopedCall: ScopedOdooCall = async (model, method, args, kwargs) => {
      const result = await scopedExecuteKw(
        creds,
        uid,
        scope,
        model,
        method,
        args,
        kwargs
      );
      if (method === "search_read") {
        assertRecordsInScope(model, result, scope);
      }
      return result;
    };

    const baseOrderFields = [
      "id",
      "state",
      "date_order",
      "pos_reference",
      "uuid",
      "session_id",
      "config_id",
      "currency_id",
      "company_id",
    ];
    let availableOrderFields = new Set<string>();
    try {
      const detected = await scopedCall("pos.order", "fields_get", [], {
        attributes: ["string", "type"],
      });
      if (
        detected &&
        typeof detected === "object" &&
        !Array.isArray(detected)
      ) {
        availableOrderFields = new Set(Object.keys(detected));
      }
    } catch (err) {
      logOdooFault("[Odoo Sync] pos.order fields_get failed:", err);
    }
    const orderFields = [
      ...baseOrderFields,
      ...optionalOrderFields(availableOrderFields),
    ];

    let orders: OdooPosOrderRaw[];
    try {
      const result = await scopedExecuteKw(
        creds,
        uid,
        scope,
        "pos.order",
        "search_read",
        [domain],
        { fields: orderFields }
      );
      orders = (Array.isArray(result)
        ? result
        : []) as unknown as OdooPosOrderRaw[];
    } catch (err) {
      // A version-specific optional field can still 500 the call; retry
      // the known-safe base list so revenue sync is not blocked.
      logOdooFault(
        "[Odoo Sync] pos.order search_read with optional fields failed, retrying base fields:",
        err
      );
      try {
        const result = await scopedExecuteKw(
          creds,
          uid,
          scope,
          "pos.order",
          "search_read",
          [domain],
          { fields: baseOrderFields }
        );
        orders = (Array.isArray(result)
          ? result
          : []) as unknown as OdooPosOrderRaw[];
        availableOrderFields = new Set(baseOrderFields);
      } catch (retryErr) {
        const statusClass = logOdooFault(
          "[Odoo Sync] pos.order search_read failed:",
          retryErr
        );
        const status = retryErr instanceof OdooRpcError ? 502 : 500;
        return NextResponse.json(
          {
            error: "Failed to fetch Odoo POS orders",
            details: odooFaultDetails(statusClass),
          },
          { status }
        );
      }
    }

    try {
      assertRecordsInScope("pos.order", orders, scope);
    } catch (err) {
      return scopeViolationResponse(err);
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
      "company_id",
    ];

    let lines: OdooPosOrderLineRaw[];
    try {
      const result = await scopedExecuteKw(
        creds,
        uid,
        scope,
        "pos.order.line",
        "search_read",
        [[["order_id", "in", orderIds]]],
        { fields: lineFields }
      );
      lines = (Array.isArray(result)
        ? result
        : []) as unknown as OdooPosOrderLineRaw[];
    } catch (err) {
      const statusClass = logOdooFault(
        "[Odoo Sync] pos.order.line search_read failed:",
        err
      );
      const status = err instanceof OdooRpcError ? 502 : 500;
      return NextResponse.json(
        {
          error: "Failed to fetch Odoo POS order lines",
          details: odooFaultDetails(statusClass),
        },
        { status }
      );
    }

    try {
      assertRecordsInScope("pos.order.line", lines, scope);
    } catch (err) {
      return scopeViolationResponse(err);
    }

    const productIds = lines
      .map((line) => (line.product_id ? line.product_id[0] : null))
      .filter((id): id is number => typeof id === "number");
    let dimensions;
    try {
      dimensions = await loadOdooDimensions(
        scopedCall,
        orders as unknown as Record<string, unknown>[],
        productIds
      );
    } catch (err) {
      if (err instanceof OdooCompanyScopeError) {
        return scopeViolationResponse(err);
      }
      logOdooFault("[Odoo Sync] dimension fetch failed:", err);
      dimensions = null;
    }

    // --- Build lookup indexes (same soft-match mechanism as Revel) --------
    const [menuItemsRes, locationsFullRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("id, name, brand_id")
        .eq("company_id", companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name, brand_id, odoo_company_id")
        .eq("company_id", companyId),
    ]);
    if (menuItemsRes.error) {
      console.error(
        "[Odoo Sync] menu_items lookup failed:",
        menuItemsRes.error.message
      );
    }
    if (locationsFullRes.error) {
      console.error(
        "[Odoo Sync] restaurant_locations lookup failed:",
        locationsFullRes.error.message
      );
    }
    const menuItemRows = (menuItemsRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
    }[];
    const locationRowsFull = (locationsFullRes.data ?? []) as {
      id: string;
      name: string;
      brand_id: string | null;
      odoo_company_id: number | null;
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
    const locationIndex = buildNameIndex(locationRowsFull);
    const locationBrandIndex = new Map<string, string | null>(
      locationRowsFull.map((l) => [l.id, l.brand_id])
    );

    // Update the mapping with full location data (was built earlier with minimal fields)
    companyLocationMap.clear();
    for (const loc of locationRowsFull) {
      if (loc.odoo_company_id !== null) {
        companyLocationMap.set(loc.odoo_company_id, loc.id);
      }
    }

    // --- Transform ----------------------------------------------------------
    const { rows: allRows, skipped } = transformOdooOrders(orders, lines, {
      companyId,
      timezone: conn.timezone,
      defaultCurrency: "MXN",
      menuItemIndex,
      locationIndex,
      locationBrandIndex,
      companyLocationMap,
      channelByOrderId: dimensions?.lookups.channelByOrderId,
      channelSourceByOrderId: dimensions?.lookups.channelSourceByOrderId,
      paymentByOrderId: dimensions?.lookups.paymentByOrderId,
      categoryByProductId: dimensions?.lookups.categoryByProductId,
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
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE).map((row) =>
        stripFailedDimensionFields(row, {
          paymentReadFailed:
            dimensions == null || dimensions.paymentReadFailed,
          categoryReadFailed:
            dimensions == null || dimensions.categoryReadFailed,
        })
      );
      const { error: upsertError, count } = await supabase
        .from("pos_sales_items")
        .upsert(batch, {
          onConflict: "company_id,pos_source,external_line_id",
          count: "exact",
        });
      if (upsertError) {
        console.error(
          "[Odoo Sync] upsert failed:",
          "PostgrestError",
          upsertError.message
        );
        return NextResponse.json(
          {
            error: "Database upsert failed",
            details: odooFaultDetails("unknown"),
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
      dimension_notes: dimensions?.notes ?? [],
      dimension_calls: dimensions?.callCount ?? 0,
    });
  } catch (err) {
    const statusClass = logOdooFault("[Odoo Sync] Unexpected error:", err);
    return NextResponse.json(
      {
        error: "Odoo sync failed",
        details: odooFaultDetails(statusClass),
      },
      { status: 500 }
    );
  }
}
