// app/api/cron/odoo-sync/route.ts
//
// GET /api/cron/odoo-sync
//
// Daily automatic Odoo POS sync, run BEFORE the briefing cron. For every
// company with an active Odoo connection it syncs "yesterday and today" in
// the company's own timezone (idempotent upsert, so overlap is harmless).
//
// AUTH: identical to the briefing cron. Vercel calls with
// `Authorization: Bearer <CRON_SECRET>`; a missing/wrong secret, or an
// unset CRON_SECRET, is a 401 before anything else runs. Nothing is read
// from the request: the company list comes from the database only.
//
// ISOLATION: each company is synced inside its own try/catch (the shared
// helper never throws); one failing company never stops the others. The
// JSON summary and logs contain only an opaque short id, counts and an
// error kind: no credentials, URLs or Odoo fault text.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCronRequest } from "@/lib/restaurant/email/scheduler";
import {
  autoSyncOdooCompany,
  opaqueCompanyId,
  type AutoSyncResult,
} from "@/lib/restaurant/odoo/auto-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (
    !isAuthorizedCronRequest(
      req.headers.get("authorization"),
      process.env.CRON_SECRET
    )
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date();

  const { data, error } = await admin
    .from("restaurant_pos_connections")
    .select("company_id")
    .eq("pos_source", "odoo")
    .eq("is_active", true);
  if (error) {
    console.error("[odoo-sync-cron] connection lookup failed:", error.message);
    return NextResponse.json(
      { error: "Could not load connections" },
      { status: 500 }
    );
  }

  const companyIds = Array.from(
    new Set(
      ((data ?? []) as Array<{ company_id: string | null }>)
        .map((r) => r.company_id)
        .filter((id): id is string => typeof id === "string" && id !== "")
    )
  );

  const results: AutoSyncResult[] = [];
  for (const companyId of companyIds) {
    let result: AutoSyncResult;
    try {
      result = await autoSyncOdooCompany(admin, companyId, now);
    } catch (err) {
      result = {
        company: opaqueCompanyId(companyId),
        ok: false,
        error_kind: err instanceof Error ? err.name : "UnknownError",
      };
    }
    if (!result.ok) {
      console.error(
        `[odoo-sync-cron] company ${result.company} failed:`,
        result.error_kind
      );
    }
    results.push(result);
  }

  const ok = results.filter((r) => r.ok).length;
  return NextResponse.json({
    companies: results.length,
    ok,
    failed: results.length - ok,
    results,
  });
}
