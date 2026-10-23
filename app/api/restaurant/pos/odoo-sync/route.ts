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
// This route stays manual and staff-only. The core logic lives in
// lib/restaurant/odoo/sync-company.ts, which the daily cron
// (app/api/cron/odoo-sync) also uses.

import { NextRequest, NextResponse } from "next/server";
import { authAndCompany } from "@/lib/restaurant/api-auth";
import { requireCapability, resolveActor } from "@/lib/auth/permissions";
import { parseInclusiveDateRange } from "@/lib/restaurant/odoo/sync-window";
import {
  logOdooFault,
  odooFaultDetails,
  syncOdooCompany,
} from "@/lib/restaurant/odoo/sync-company";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A month-long sync (~20k rows) can exceed Vercel's default limit and
// return a 504 with no JSON. 300s matches the briefing-email cron ceiling.
export const maxDuration = 300;

interface RequestBody {
  start_date?: string;
  end_date?: string;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authAndCompany();
    if (!auth.ok) return auth.response;
    const { supabase, companyId, userId } = auth;

    // Staff only: no company role is read (companyId null = no membership
    // lookup), so only the Milton-staff flag can pass.
    const actor = await resolveActor(null, userId, { companyId: null });
    const denied = requireCapability(actor, "odoo.sync");
    if (denied) return denied;

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

    const outcome = await syncOdooCompany({
      supabase,
      companyId,
      start_date,
      end_date,
    });
    return NextResponse.json(outcome.body, { status: outcome.status });
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
