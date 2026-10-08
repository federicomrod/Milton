// app/api/admin/odoo/connection/route.ts
//
// Admin-only Odoo connection management. GET loads the current connection
// metadata (never the API key) for a chosen company; POST saves or updates
// it after authenticating and discovering companies. The API key is write-only
// (never pre-filled) and cleared from client state after submit.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  storeOdooSecret,
  assertOdooEncryptionConfigured,
  OdooSecretConfigError,
} from "@/lib/restaurant/odoo/secrets";
import {
  authenticate,
  OdooAuthenticationError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import { discoverOdooCompanies } from "@/lib/restaurant/odoo/scoped";
import { resolveOdooCompanySelection } from "@/lib/restaurant/odoo/company-selection";
import {
  assertOdooBaseUrlAllowed,
  parseAllowedHosts,
  OdooHostNotAllowedError,
} from "@/lib/restaurant/odoo/allowed-hosts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const { data: company, error: companyError } = await adminClient
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const { data: connection, error: connError } = await adminClient
    .from("restaurant_pos_connections")
    .select(
      "id, base_url, database_name, username, timezone, odoo_company_ids, updated_at"
    )
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .maybeSingle();

  if (connError) {
    return NextResponse.json(
      { error: "Failed to load connection" },
      { status: 500 }
    );
  }

  if (!connection) {
    return NextResponse.json({
      company: { id: company.id, name: company.name },
      connection: null,
      has_api_key: false,
    });
  }

  const { data: secret, error: secretError } = await adminClient
    .from("restaurant_pos_secrets")
    .select("id")
    .eq("connection_id", connection.id)
    .eq("company_id", companyId)
    .maybeSingle();

  return NextResponse.json({
    company: { id: company.id, name: company.name },
    connection: {
      id: connection.id,
      base_url: connection.base_url,
      database_name: connection.database_name,
      username: connection.username,
      timezone: connection.timezone,
      odoo_company_ids: connection.odoo_company_ids,
      updated_at: connection.updated_at,
    },
    has_api_key: !!secret,
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
    base_url?: unknown;
    database_name?: unknown;
    username?: unknown;
    timezone?: unknown;
    api_key?: unknown;
    odoo_company_ids?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const companyId = requiredString(body.company_id);
  const baseUrl = requiredString(body.base_url)?.replace(/\/+$/, "") ?? null;
  const databaseName = requiredString(body.database_name);
  const username = requiredString(body.username);
  const timezone = requiredString(body.timezone);
  const apiKey = requiredString(body.api_key);

  const missing: string[] = [];
  if (!companyId) missing.push("company_id");
  if (!baseUrl) missing.push("base_url");
  if (!databaseName) missing.push("database_name");
  if (!username) missing.push("username");
  if (!timezone) missing.push("timezone");
  if (!apiKey) missing.push("api_key");
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `Missing required field(s): ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  const allowedHosts = parseAllowedHosts();
  try {
    assertOdooBaseUrlAllowed(baseUrl as string, allowedHosts);
  } catch (err) {
    if (err instanceof OdooHostNotAllowedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // Verify encryption key is configured before any DB write
  try {
    assertOdooEncryptionConfigured();
  } catch (err) {
    if (err instanceof OdooSecretConfigError) {
      return NextResponse.json(
        { error: "Encryption key is not configured" },
        { status: 500 }
      );
    }
    throw err;
  }

  const adminClient = createAdminClient();
  const { data: company, error: companyError } = await adminClient
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .maybeSingle();

  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const creds: OdooCredentials = {
    baseUrl: baseUrl as string,
    database: databaseName as string,
    username: username as string,
    apiKey: apiKey as string,
  };

  let uid: number;
  try {
    uid = await authenticate(creds);
  } catch (err) {
    if (err instanceof OdooAuthenticationError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Could not reach Odoo instance" },
      { status: 502 }
    );
  }

  let accessible: { id: number; name: string }[];
  try {
    accessible = (await discoverOdooCompanies(creds, uid)).companies;
  } catch {
    return NextResponse.json(
      { error: "Could not read Odoo companies" },
      { status: 502 }
    );
  }

  const { data: existing, error: lookupError } = await adminClient
    .from("restaurant_pos_connections")
    .select("id, base_url, database_name, username, timezone, odoo_company_ids")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "Failed to check existing connection" },
      { status: 500 }
    );
  }

  const sameDatabase =
    existing?.base_url === baseUrl && existing?.database_name === databaseName;
  const selection = resolveOdooCompanySelection({
    requested: body.odoo_company_ids,
    accessible,
    existing: sameDatabase
      ? (existing?.odoo_company_ids as number[] | null)
      : null,
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

  let connectionId: string;
  const isNewConnection = !existing?.id;

  if (existing?.id) {
    connectionId = existing.id;
    const { error: updateError } = await adminClient
      .from("restaurant_pos_connections")
      .update({
        base_url: baseUrl,
        database_name: databaseName,
        username,
        timezone,
        odoo_company_ids: selection.selected,
        is_active: true,
      })
      .eq("id", connectionId);
    if (updateError) {
      return NextResponse.json(
        { error: "Failed to update connection" },
        { status: 500 }
      );
    }
  } else {
    const { data: inserted, error: insertError } = await adminClient
      .from("restaurant_pos_connections")
      .insert({
        company_id: companyId,
        pos_source: "odoo",
        base_url: baseUrl,
        database_name: databaseName,
        username,
        timezone,
        odoo_company_ids: selection.selected,
        is_active: true,
      })
      .select("id")
      .single();
    if (insertError || !inserted?.id) {
      return NextResponse.json(
        { error: "Failed to create connection" },
        { status: 500 }
      );
    }
    connectionId = inserted.id;
  }

  try {
    await storeOdooSecret(connectionId, companyId as string, apiKey as string);
  } catch {
    // Rollback: if secret storage fails after metadata write, delete the
    // newly inserted connection or revert the update to prevent leaving
    // stale metadata with no secret.
    if (isNewConnection) {
      await adminClient
        .from("restaurant_pos_connections")
        .delete()
        .eq("id", connectionId);
    } else if (existing) {
      // Revert update to previous values
      await adminClient
        .from("restaurant_pos_connections")
        .update({
          base_url: existing.base_url,
          database_name: existing.database_name,
          username: existing.username,
          timezone: existing.timezone,
          odoo_company_ids: existing.odoo_company_ids,
        })
        .eq("id", connectionId);
    }
    return NextResponse.json(
      { error: "Failed to store credential" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    accessible_companies: accessible.map((c) => ({ id: c.id, name: c.name })),
    selected_company_ids: selection.selected,
    selection_required: selection.selectionRequired,
  });
}
