// lib/ai/daily-cost-check.ts
//
// Runs at the end of /api/cron/briefing-email (no cron of its own): adds up
// yesterday's (UTC) estimated AI cost and errors from ai_usage_events and
// alerts the admin when the cost is over the threshold or any quota/billing
// error happened. Never throws.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendAiAlert } from "./alert";

/** Alert when yesterday's estimated cost is over this many USD. */
export const AI_DAILY_COST_THRESHOLD_USD = 1.0;

export interface DailyAiSummary {
  totalUsd: number;
  calls: number;
  quotaOrBilling: number;
  otherErrors: number;
}

export function summarizeEvents(
  rows: Array<{
    est_cost_usd: number | string | null;
    status: string;
    error_kind: string | null;
  }>
): DailyAiSummary {
  let totalUsd = 0;
  let quotaOrBilling = 0;
  let otherErrors = 0;
  for (const r of rows) {
    totalUsd += Number(r.est_cost_usd ?? 0) || 0;
    if (r.error_kind === "quota" || r.error_kind === "billing") {
      quotaOrBilling += 1;
    } else if (r.status === "error") {
      otherErrors += 1;
    }
  }
  return {
    totalUsd: Math.round(totalUsd * 1e6) / 1e6,
    calls: rows.length,
    quotaOrBilling,
    otherErrors,
  };
}

export function shouldAlert(
  s: DailyAiSummary,
  threshold = AI_DAILY_COST_THRESHOLD_USD
): boolean {
  return s.totalUsd > threshold || s.quotaOrBilling > 0;
}

export async function runDailyAiCostCheck(now = new Date()): Promise<void> {
  try {
    const end = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate()
    );
    const start = end - 24 * 60 * 60 * 1000;
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("ai_usage_events")
      .select("est_cost_usd, status, error_kind")
      .gte("created_at", new Date(start).toISOString())
      .lt("created_at", new Date(end).toISOString())
      .limit(50000);
    if (error || !data) return;
    const summary = summarizeEvents(data);
    if (!shouldAlert(summary)) return;
    const day = new Date(start).toISOString().slice(0, 10);
    await sendAiAlert(`Milton: resumen de la IA del ${day}`, [
      `Costo estimado: $${summary.totalUsd.toFixed(2)} (umbral $${AI_DAILY_COST_THRESHOLD_USD.toFixed(2)})`,
      `Llamadas: ${summary.calls}`,
      `Errores de cuota o saldo: ${summary.quotaOrBilling}`,
      `Otros errores: ${summary.otherErrors}`,
    ]);
  } catch {
    console.error("[ai-usage] daily cost check failed");
  }
}
