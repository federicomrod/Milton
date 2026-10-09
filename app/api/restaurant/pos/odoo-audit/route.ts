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

import { NextResponse } from "next/server";
import { OdooRpcError } from "@/lib/restaurant/odoo/client";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadOdooSession } from "@/lib/restaurant/odoo/load-connection";
import {
  assertRecordsInScope,
  discoverOdooCompanies,
  scopedExecuteKw,
} from "@/lib/restaurant/odoo/scoped";
import {
  buildOdooAuditReport,
  type OdooAuditRow,
  type OdooConfigCompanyMap,
} from "@/lib/restaurant/odoo/audit";

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

export async function GET() {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    const session = await loadOdooSession(supabase, companyId, "Odoo Audit");
    if (!session.ok) return session.response;
    const { conn, creds, uid } = session;

    // --- This tenant's existing Odoo rows, paged -------------------------
    const rows: OdooAuditRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("pos_sales_items")
        .select(
          "id, order_id, sale_date, location_id, gross_revenue, source_metadata"
        )
        .eq("company_id", companyId)
        .eq("pos_source", "odoo")
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
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

    return NextResponse.json(
      buildOdooAuditReport(rows, configCompanyMap, conn.odoo_company_ids)
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
