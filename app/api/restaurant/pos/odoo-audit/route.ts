// app/api/restaurant/pos/odoo-audit/route.ts
//
// GET /api/restaurant/pos/odoo-audit
//
// Strictly READ-ONLY audit of existing pos_source='odoo' rows: which Odoo
// company did each row come from, and did it land on the right Milton
// location? It reports only; cleanup (purge / re-sync) is a separate,
// explicitly approved step.
//
// Read-only in Supabase (select only, RLS-backed client, paged because
// PostgREST caps rows per response) and in Odoo (search_read of pos.config
// through the scoped helper, which still injects domain and context).
//
// Documented exception: the Odoo scope here is the Odoo user's FULL
// accessible set, not the tenant's selection — the point is to find rows
// that belong to a company that is NOT selected.

import { NextRequest, NextResponse } from "next/server";
import {
  OdooRpcError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadOdooSession } from "@/lib/restaurant/odoo/load-connection";
import {
  assertOdooScope,
  assertRecordsInScope,
  discoverOdooCompanies,
  scopedExecuteKw,
  type OdooScope,
} from "@/lib/restaurant/odoo/scoped";
import {
  buildLiveOdooDimensionReport,
  buildOdooAuditReport,
  type LiveOdooDimensionReport,
  type OdooAuditRow,
  type OdooConfigCompanyMap,
} from "@/lib/restaurant/odoo/audit";
import {
  chunkIds,
  loadOdooDimensions,
  optionalOrderFields,
  type ScopedOdooCall,
} from "@/lib/restaurant/odoo/dimension-fetch";
import {
  QUERY_PAD_DAYS,
  addDays,
  parseInclusiveDateRange,
} from "@/lib/restaurant/odoo/sync-window";
import { ODOO_COMPLETED_STATES } from "@/lib/restaurant/odoo/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const PAGE_SIZE = 1000;

async function fetchLiveDimensions(
  creds: OdooCredentials,
  uid: number,
  selectedIds: number[] | null | undefined,
  range: { start_date: string; end_date: string }
): Promise<LiveOdooDimensionReport> {
  let scope: OdooScope;
  if (selectedIds && selectedIds.length > 0) {
    scope = assertOdooScope(selectedIds);
  } else {
    const { companies } = await discoverOdooCompanies(creds, uid);
    scope = assertOdooScope(companies.map((c) => c.id));
  }

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

  const queryStart = addDays(range.start_date, -QUERY_PAD_DAYS);
  const queryEnd = addDays(range.end_date, QUERY_PAD_DAYS);
  const domain = [
    ["date_order", ">=", `${queryStart} 00:00:00`],
    ["date_order", "<=", `${queryEnd} 23:59:59`],
    ["state", "in", [...ODOO_COMPLETED_STATES]],
  ];
  const baseOrderFields = [
    "id",
    "state",
    "date_order",
    "company_id",
    "config_id",
  ];
  let availableOrderFields = new Set<string>();
  try {
    const detected = await scopedCall("pos.order", "fields_get", [], {
      attributes: ["string", "type"],
    });
    if (detected && typeof detected === "object" && !Array.isArray(detected)) {
      availableOrderFields = new Set(Object.keys(detected));
    }
  } catch {
    availableOrderFields = new Set(baseOrderFields);
  }

  let orders: Record<string, unknown>[] = [];
  try {
    const result = await scopedCall("pos.order", "search_read", [domain], {
      fields: [
        ...baseOrderFields,
        ...optionalOrderFields(availableOrderFields),
      ],
    });
    orders = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  } catch {
    const result = await scopedCall("pos.order", "search_read", [domain], {
      fields: baseOrderFields,
    });
    orders = Array.isArray(result) ? (result as Record<string, unknown>[]) : [];
  }

  const orderIds = orders
    .map((o) => o.id)
    .filter((id): id is number => typeof id === "number");
  const lineProductByOrderId = new Map<number, number[]>();
  const productIds: number[] = [];
  if (orderIds.length > 0) {
    for (const chunk of chunkIds(orderIds)) {
      const lines = await scopedCall(
        "pos.order.line",
        "search_read",
        [[["order_id", "in", chunk]]],
        { fields: ["id", "order_id", "product_id", "company_id"] }
      );
      if (!Array.isArray(lines)) continue;
      for (const line of lines as Record<string, unknown>[]) {
        const orderId = Array.isArray(line.order_id)
          ? (line.order_id[0] as number)
          : null;
        const productId = Array.isArray(line.product_id)
          ? (line.product_id[0] as number)
          : null;
        if (orderId === null || productId === null) continue;
        productIds.push(productId);
        const list = lineProductByOrderId.get(orderId) ?? [];
        list.push(productId);
        lineProductByOrderId.set(orderId, list);
      }
    }
  }

  const dimensions = await loadOdooDimensions(scopedCall, orders, productIds);
  return buildLiveOdooDimensionReport({
    orders,
    payments: dimensions.payments,
    products: dimensions.products,
    availableOrderFields: dimensions.availableOrderFields,
    availablePaymentFields: dimensions.availablePaymentFields,
    availableProductFields: dimensions.availableProductFields,
    channelByOrderId: dimensions.lookups.channelByOrderId,
    paymentByOrderId: dimensions.lookups.paymentByOrderId,
    categoryByProductId: dimensions.lookups.categoryByProductId,
    posCategories: dimensions.posCategories,
    lineProductByOrderId,
    notes: dimensions.notes,
    callCount: dimensions.callCount,
  });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    const session = await loadOdooSession(supabase, companyId, "Odoo Audit");
    if (!session.ok) return session.response;
    const { conn, creds, uid } = session;

    const url = new URL(req.url);
    const startParam = url.searchParams.get("start_date");
    const endParam = url.searchParams.get("end_date");
    let range: { start_date: string; end_date: string } | null = null;
    if (startParam || endParam) {
      const parsed = parseInclusiveDateRange(startParam, endParam);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      range = { start_date: parsed.start_date, end_date: parsed.end_date };
    }

    // --- This tenant's existing Odoo rows, paged -------------------------
    const rows: OdooAuditRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase
        .from("pos_sales_items")
        .select(
          "id, order_id, sale_date, location_id, gross_revenue, source_metadata, sales_channel, payment_type, category, sub_category"
        )
        .eq("company_id", companyId)
        .eq("pos_source", "odoo")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (range) {
        query = query
          .gte("sale_date", range.start_date)
          .lte("sale_date", range.end_date);
      }
      const { data, error } = await query;
      if (error) {
        console.error(
          "[Odoo Audit] row read failed:",
          "PostgrestError",
          error.message
        );
        return NextResponse.json(
          {
            error: "Could not read existing Odoo rows",
            details: odooFaultDetails("unknown"),
          },
          { status: 500 }
        );
      }
      const page = (data ?? []) as OdooAuditRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }

    // --- Distinct pos.config ids that still need an Odoo company lookup --
    const configIds = new Set<number>();
    for (const r of rows) {
      const meta = r.source_metadata ?? {};
      if (typeof meta.odoo_company_id === "number") continue;
      if (typeof meta.config_id === "number") configIds.add(meta.config_id);
    }

    const configCompanyMap: OdooConfigCompanyMap = new Map();
    if (configIds.size > 0) {
      const { companies } = await discoverOdooCompanies(creds, uid);
      const scope = { companyIds: companies.map((c) => c.id) };
      const result = await scopedExecuteKw(
        creds,
        uid,
        scope,
        "pos.config",
        "search_read",
        [[["id", "in", Array.from(configIds)]]],
        { fields: ["id", "name", "company_id"] }
      );
      assertRecordsInScope("pos.config", result, scope);
      for (const cfg of result as unknown as {
        id: number;
        company_id: [number, string];
      }[]) {
        configCompanyMap.set(cfg.id, {
          id: cfg.company_id[0],
          name: cfg.company_id[1],
        });
      }
    }

    let odooDimensions: LiveOdooDimensionReport | null = null;
    if (range) {
      try {
        odooDimensions = await fetchLiveDimensions(
          creds,
          uid,
          conn.odoo_company_ids,
          range
        );
      } catch (err) {
        logOdooFault("[Odoo Audit] live dimension fetch failed:", err);
        odooDimensions = {
          available_fields: {
            "pos.order": [],
            "pos.payment": null,
            "product.product": null,
          },
          by_odoo_company: [],
          multi_payment_rule:
            "Largest summed pos.payment amount per method name wins; Mixed on a tie",
          notes: [
            "Live Odoo dimension fetch failed; stored row audit is still valid",
          ],
          call_count: 0,
        };
      }
    }

    return NextResponse.json(
      buildOdooAuditReport(
        rows,
        configCompanyMap,
        conn.odoo_company_ids,
        new Date(),
        range,
        odooDimensions
      )
    );
  } catch (err) {
    const statusClass = logOdooFault("[Odoo Audit] failed:", err);
    return NextResponse.json(
      {
        error: "Odoo audit failed",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }
}
