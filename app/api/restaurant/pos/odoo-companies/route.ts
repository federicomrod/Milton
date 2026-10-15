// app/api/restaurant/pos/odoo-companies/route.ts
//
// API behind the Odoo company picker. The picker UI itself is build item 3
// (Odoo connect/settings UI) and will call this route.
//
// GET  -> { accessible_companies: [{id,name}], selected_company_ids,
//           selection_required }. Strictly read-only: never writes, not
//           even an auto-selection.
// POST { odoo_company_ids: number[] } -> saves a selection, only after
//           re-running discovery live and validating every ID against the
//           companies the stored Odoo user can access.
//
// The Milton company is resolved server-side by authAndCompany() and is
// never read from the request. Odoo IDs only ever come from discovery.

import { NextRequest, NextResponse } from "next/server";
import { OdooRpcError } from "@/lib/restaurant/odoo/client";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { loadOdooSession } from "@/lib/restaurant/odoo/load-connection";
import { discoverOdooCompanies } from "@/lib/restaurant/odoo/scoped";
import { resolveOdooCompanySelection } from "@/lib/restaurant/odoo/company-selection";

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

export async function GET() {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    const session = await loadOdooSession(
      supabase,
      companyId,
      "Odoo Companies"
    );
    if (!session.ok) return session.response;
    const { conn, creds, uid } = session;

    const { companies } = await discoverOdooCompanies(creds, uid);
    const accessibleIds = new Set(companies.map((c) => c.id));
    const stored = conn.odoo_company_ids;
    const storedValid =
      Array.isArray(stored) &&
      stored.length > 0 &&
      stored.every((id) => accessibleIds.has(id));

    return NextResponse.json({
      accessible_companies: companies.map((c) => ({ id: c.id, name: c.name })),
      selected_company_ids: stored ?? null,
      selection_required: !storedValid,
    });
  } catch (err) {
    const statusClass = logOdooFault("[Odoo Companies] GET failed:", err);
    return NextResponse.json(
      {
        error: "Could not list Odoo companies",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId } = auth;

    let body: { odoo_company_ids?: unknown };
    try {
      body = (await req.json()) as { odoo_company_ids?: unknown };
    } catch {
      return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
    }
    // Must be present: an omitted value is not a valid "selection".
    if (!Array.isArray(body.odoo_company_ids)) {
      return NextResponse.json(
        { error: "odoo_company_ids must be a non-empty array of company IDs" },
        { status: 400 }
      );
    }

    const session = await loadOdooSession(
      supabase,
      companyId,
      "Odoo Companies"
    );
    if (!session.ok) return session.response;
    const { conn, creds, uid } = session;

    const { companies } = await discoverOdooCompanies(creds, uid);
    const result = resolveOdooCompanySelection({
      requested: body.odoo_company_ids,
      accessible: companies,
      existing: conn.odoo_company_ids,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          accessible_companies: result.accessible.map((c) => ({
            id: c.id,
            name: c.name,
          })),
        },
        { status: result.status }
      );
    }

    const { error: updateError } = await supabase
      .from("restaurant_pos_connections")
      .update({ odoo_company_ids: result.selected })
      .eq("id", conn.id)
      .eq("company_id", companyId);
    if (updateError) {
      console.error(
        "[Odoo Companies] save failed:",
        "PostgrestError",
        updateError.message
      );
      return NextResponse.json(
        {
          error: "Could not save the Odoo company selection",
          details: odooFaultDetails("unknown"),
        },
        { status: 500 }
      );
    }

    const selected = new Set(result.selected ?? []);
    return NextResponse.json({
      success: true,
      selected_companies: companies
        .filter((c) => selected.has(c.id))
        .map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (err) {
    const statusClass = logOdooFault("[Odoo Companies] POST failed:", err);
    return NextResponse.json(
      {
        error: "Could not save the Odoo company selection",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }
}
