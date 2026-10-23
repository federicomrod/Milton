// lib/restaurant/odoo/auto-sync.ts
//
// Automatic (no user session) Odoo sync for ONE company: "yesterday and
// today" in the company's local timezone. Shared by the daily sync cron
// (app/api/cron/odoo-sync) and the briefing cron, which runs it first so a
// briefing never reads data older than that day's sync.
//
// The supabase client is the service-role admin client; every query is
// still filtered by company_id. Results are safe to log and return: only an
// opaque id, row counts and an error kind (never credentials, URLs or Odoo
// fault text).

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTimezone } from "@/lib/restaurant/email/preferences";
import { getLocalMoment } from "@/lib/restaurant/email/scheduler";
import { resolvePosTimezone } from "@/lib/restaurant/pos-timezone";
import { addDays } from "@/lib/restaurant/odoo/sync-window";
import { syncOdooCompany } from "@/lib/restaurant/odoo/sync-company";

export interface AutoSyncResult {
  /** Opaque short id (hash prefix), never the real company id. */
  company: string;
  ok: boolean;
  /** True when the company has no active Odoo connection (nothing to do). */
  skipped?: boolean;
  rows?: number;
  error_kind?: string;
}

/** Stable, non-reversible short label for logs and API output. */
export function opaqueCompanyId(companyId: string): string {
  return createHash("sha256").update(companyId).digest("hex").slice(0, 8);
}

/** "Yesterday and today" as local dates in `timezone` at instant `now`. */
export function yesterdayAndToday(
  now: Date,
  timezone: string
): { start_date: string; end_date: string } {
  const today = getLocalMoment(now, timezone).dateKey;
  return { start_date: addDays(today, -1), end_date: today };
}

/**
 * Syncs yesterday + today for one company. Never throws: every failure is
 * returned as { ok: false, error_kind }. A company without an active Odoo
 * connection returns { ok: true, skipped: true } without contacting Odoo.
 */
export async function autoSyncOdooCompany(
  supabase: SupabaseClient,
  companyId: string,
  now: Date = new Date()
): Promise<AutoSyncResult> {
  const company = opaqueCompanyId(companyId);
  try {
    const { data: conn, error } = await supabase
      .from("restaurant_pos_connections")
      .select("timezone")
      .eq("company_id", companyId)
      .eq("pos_source", "odoo")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (error) return { company, ok: false, error_kind: "connection_lookup" };
    if (!conn) return { company, ok: true, skipped: true };

    const timezone =
      normalizeTimezone((conn as { timezone?: string | null }).timezone) ??
      (await resolvePosTimezone(supabase, companyId));
    const { start_date, end_date } = yesterdayAndToday(now, timezone);

    const outcome = await syncOdooCompany({
      supabase,
      companyId,
      start_date,
      end_date,
    });
    if (outcome.status === 200) {
      const rows = outcome.body.rows_upserted;
      return {
        company,
        ok: true,
        rows: typeof rows === "number" ? rows : 0,
      };
    }
    // body.error is one of our own fixed, secret-free strings.
    const kind =
      typeof outcome.body.error === "string"
        ? outcome.body.error.slice(0, 80)
        : `http_${outcome.status}`;
    return { company, ok: false, error_kind: kind };
  } catch (err) {
    return {
      company,
      ok: false,
      error_kind: err instanceof Error ? err.name : "UnknownError",
    };
  }
}
