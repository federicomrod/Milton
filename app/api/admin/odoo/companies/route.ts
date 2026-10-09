// app/api/admin/odoo/companies/route.ts
//
// Admin-only: GET loads current Odoo company selection and discovered companies,
// POST updates the selection after validation.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  authenticate,
  OdooRpcError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import { discoverOdooCompanies } from "@/lib/restaurant/odoo/scoped";
import { resolveOdooCompanySelection } from "@/lib/restaurant/odoo/company-selection";
import { loadDecryptedOdooSecret } from "@/lib/restaurant/odoo/secrets";

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

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");

  if (!companyId) {
    return NextResponse.json(
      { error: "company_id query parameter is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { data: connection, error: connError } = await adminClient
    .from("restaurant_pos_connections")
    .select("id, base_url, database_name, username, odoo_company_ids")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .maybeSingle();

  if (connError) {
    const statusClass = logOdooFault(
      "[admin/odoo/companies] GET load failed:",
      connError
    );
    return NextResponse.json(
      {
        error: "Failed to load connection",
        details: odooFaultDetails(statusClass),
      },
      { status: 500 }
    );
  }

  if (!connection) {
    return NextResponse.json(
      { error: "No Odoo connection configured for this company" },
      { status: 404 }
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await loadDecryptedOdooSecret(connection.id, companyId);
  } catch (err) {
    console.error(
      "[admin/odoo/companies] GET credential lookup failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      {
        error: "Could not load the stored Odoo credential",
        details: odooFaultDetails("unknown"),
      },
      { status: 500 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "No API key stored for this connection" },
      { status: 404 }
    );
  }

  const creds: OdooCredentials = {
    baseUrl: connection.base_url,
    database: connection.database_name,
    username: connection.username,
    apiKey,
  };

  let uid: number;
  let companies: { id: number; name: string }[];
  try {
    uid = await authenticate(creds);
    companies = (await discoverOdooCompanies(creds, uid)).companies;
  } catch (err) {
    const statusClass = logOdooFault(
      "[admin/odoo/companies] GET Odoo unreachable:",
      err
    );
    return NextResponse.json(
      {
        error: "Could not reach Odoo to discover companies",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    accessible_companies: companies.map((c) => ({ id: c.id, name: c.name })),
    selected_company_ids: connection.odoo_company_ids,
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = await isUserAdminServer(user.id);
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    company_id?: unknown;
    odoo_company_ids?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const companyId =
    typeof body.company_id === "string" && body.company_id.trim()
      ? body.company_id.trim()
      : null;

  if (!companyId) {
    return NextResponse.json(
      { error: "company_id is required" },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { data: connection, error: connError } = await adminClient
    .from("restaurant_pos_connections")
    .select("id, base_url, database_name, username, odoo_company_ids")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .maybeSingle();

  if (connError) {
    const statusClass = logOdooFault(
      "[admin/odoo/companies] POST load failed:",
      connError
    );
    return NextResponse.json(
      {
        error: "Failed to load connection",
        details: odooFaultDetails(statusClass),
      },
      { status: 500 }
    );
  }

  if (!connection) {
    return NextResponse.json(
      { error: "No Odoo connection configured for this company" },
      { status: 404 }
    );
  }

  let apiKey: string | null;
  try {
    apiKey = await loadDecryptedOdooSecret(connection.id, companyId);
  } catch (err) {
    console.error(
      "[admin/odoo/companies] POST credential lookup failed:",
      err instanceof Error ? err.name : "Unknown error"
    );
    return NextResponse.json(
      {
        error: "Could not load the stored Odoo credential",
        details: odooFaultDetails("unknown"),
      },
      { status: 500 }
    );
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "No API key stored for this connection" },
      { status: 404 }
    );
  }

  const creds: OdooCredentials = {
    baseUrl: connection.base_url,
    database: connection.database_name,
    username: connection.username,
    apiKey,
  };

  let uid: number;
  let accessible: { id: number; name: string }[];
  try {
    uid = await authenticate(creds);
    accessible = (await discoverOdooCompanies(creds, uid)).companies;
  } catch (err) {
    const statusClass = logOdooFault(
      "[admin/odoo/companies] POST Odoo unreachable:",
      err
    );
    return NextResponse.json(
      {
        error: "Could not reach Odoo to validate companies",
        details: odooFaultDetails(statusClass),
      },
      { status: 502 }
    );
  }

  const selection = resolveOdooCompanySelection({
    requested: body.odoo_company_ids,
    accessible,
    existing: connection.odoo_company_ids as number[] | null,
  });

  if (!selection.ok) {
    return NextResponse.json(
      {
        error: selection.error,
        accessible_companies: selection.accessible.map((c) => ({
          id: c.id,
          name: c.name,
        })),
      },
      { status: selection.status }
    );
  }

  const { error: updateError } = await adminClient
    .from("restaurant_pos_connections")
    .update({ odoo_company_ids: selection.selected })
    .eq("id", connection.id);

  if (updateError) {
    const statusClass = logOdooFault(
      "[admin/odoo/companies] save failed:",
      updateError
    );
    return NextResponse.json(
      {
        error: "Failed to update company selection",
        details: odooFaultDetails(statusClass),
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    selected_company_ids: selection.selected,
  });
}
