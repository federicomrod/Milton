// app/api/admin/odoo/test-connection/route.ts
//
// Admin-only test endpoint: authenticate + discover companies, nothing written.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUserAdminServer } from "@/lib/profile-service-server";
import {
  authenticate,
  OdooAuthenticationError,
  type OdooCredentials,
} from "@/lib/restaurant/odoo/client";
import { discoverOdooCompanies } from "@/lib/restaurant/odoo/scoped";
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
    base_url?: unknown;
    database_name?: unknown;
    username?: unknown;
    api_key?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const baseUrl = requiredString(body.base_url)?.replace(/\/+$/, "") ?? null;
  const databaseName = requiredString(body.database_name);
  const username = requiredString(body.username);
  const apiKey = requiredString(body.api_key);

  const missing: string[] = [];
  if (!baseUrl) missing.push("base_url");
  if (!databaseName) missing.push("database_name");
  if (!username) missing.push("username");
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

  let companies: { id: number; name: string }[];
  try {
    companies = (await discoverOdooCompanies(creds, uid)).companies;
  } catch {
    return NextResponse.json(
      { error: "Could not read Odoo companies" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    success: true,
    companies: companies.map((c) => ({ id: c.id, name: c.name })),
  });
}
