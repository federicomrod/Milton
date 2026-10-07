// lib/restaurant/odoo/load-connection.ts
//
// Shared server-side loader for routes that need a live Odoo session
// (odoo-companies, odoo-audit): active connection for the caller's Milton
// company (RLS-backed client, company resolved server-side), decrypted API
// key, then authenticate(). Returns a ready NextResponse on any failure so
// routes stay tiny. The odoo-sync route keeps its own inline flow because
// it must check the company selection BEFORE decrypting the secret.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  authenticate,
  OdooAuthenticationError,
  type OdooCredentials,
} from "./client";
import { loadDecryptedOdooSecret } from "./secrets";
import type { RestaurantPosConnection } from "@/types/restaurant";

export type LoadedOdooSession =
  | {
      ok: true;
      conn: RestaurantPosConnection;
      creds: OdooCredentials;
      uid: number;
    }
  | { ok: false; response: NextResponse };

export async function loadOdooSession(
  supabase: SupabaseClient,
  companyId: string,
  logTag: string
): Promise<LoadedOdooSession> {
  const fail = (body: Record<string, unknown>, status: number) => ({
    ok: false as const,
    response: NextResponse.json(body, { status }),
  });

  const { data, error } = await supabase
    .from("restaurant_pos_connections")
    .select("*")
    .eq("company_id", companyId)
    .eq("pos_source", "odoo")
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    console.error(`[${logTag}] connection lookup failed:`, error.message);
    return fail({ error: "Could not look up Odoo connection config" }, 500);
  }
  if (!data) {
    return fail(
      { error: "No active Odoo connection configured for this company" },
      404
    );
  }
  const conn = data as RestaurantPosConnection;

  let apiKey: string | null;
  try {
    apiKey = await loadDecryptedOdooSecret(conn.id, companyId);
  } catch (err) {
    console.error(
      `[${logTag}] credential lookup failed:`,
      err instanceof Error ? err.name : "Unknown error"
    );
    return fail({ error: "Could not load the stored Odoo credential" }, 500);
  }
  if (!apiKey) {
    return fail(
      { error: "No Odoo credential configured for this company" },
      404
    );
  }

  const creds: OdooCredentials = {
    baseUrl: conn.base_url.replace(/\/+$/, ""),
    database: conn.database_name,
    username: conn.username,
    apiKey,
  };
  try {
    const uid = await authenticate(creds);
    return { ok: true, conn, creds, uid };
  } catch (err) {
    if (err instanceof OdooAuthenticationError) {
      return fail({ error: err.message }, 401);
    }
    console.error(
      `[${logTag}] authentication failed:`,
      err instanceof Error ? err.name : "Unknown error"
    );
    return fail({ error: "Could not reach Odoo instance" }, 502);
  }
}
