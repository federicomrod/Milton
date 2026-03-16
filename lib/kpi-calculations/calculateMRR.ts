import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";

/**
 * Monthly Recurring Revenue: sum of MRR for subscriptions that are active
 * (and in range). Looks for a table named "subscriptions" or "subscription"
 * and accepts common field names for status and MRR.
 */
const ACTIVE_STATUSES = new Set([
  "active",
  "current",
  "live",
  "ongoing",
  "subscribed",
]);

function getMrrValue(d: Record<string, unknown>): number | null {
  const exact =
    d["Monthly Recurring Revenue"] ??
    d.monthly_recurring_revenue ??
    d.mrr ??
    d.MRR;
  if (exact != null) {
    const n = typeof exact === "number" ? exact : parseFloat(String(exact));
    if (!Number.isNaN(n) && n > 0) return n;
  }
  for (const [key, value] of Object.entries(d)) {
    if (value == null) continue;
    if (
      /mrr|monthly\s*recurring|recurring\s*revenue|monthly\s*revenue/i.test(key)
    ) {
      const n = typeof value === "number" ? value : parseFloat(String(value));
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

function getStatus(d: Record<string, unknown>): string {
  const raw =
    d["Status (active, paused, cancelled, etc.)"] ??
    d.status ??
    d.Status ??
    d.state ??
    "";
  return String(raw).toLowerCase().trim();
}

export async function calculateMRR(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    return { currentValue: 0, historicalData: [] };
  }

  const rows = await getModelDataRows(
    supabase,
    company.id,
    "subscriptions",
    "subscription"
  );

  const toDateObj = new Date(toDate);

  let mrr = 0;
  const monthlyMrr: { [period: string]: number } = {};

  for (const row of rows) {
    const d = row as Record<string, unknown> | null;
    if (!d || typeof d !== "object") continue;

    const status = getStatus(d);
    if (!ACTIVE_STATUSES.has(status)) continue;

    const mrrNum = getMrrValue(d);
    if (mrrNum == null || mrrNum <= 0) continue;

    const endRaw = d["End Date"] ?? d.end_date ?? d.end;
    const endDate = endRaw ? new Date(String(endRaw)) : null;
    if (
      endDate != null &&
      !isNaN(endDate.getTime()) &&
      endDate < new Date(fromDate)
    )
      continue;

    const startRaw = d["Start Date"] ?? d.start_date ?? d.start;
    const startDate = startRaw ? new Date(String(startRaw)) : null;
    if (
      startDate != null &&
      !isNaN(startDate.getTime()) &&
      startDate > toDateObj
    )
      continue;

    mrr += mrrNum;

    // Build historical: for each month in range when this sub was active, add MRR
    const subStart =
      startDate && !isNaN(startDate.getTime()) ? startDate : new Date(fromDate);
    const subEnd = endDate && !isNaN(endDate.getTime()) ? endDate : toDateObj;
    const fromObj = new Date(fromDate);
    const monthStart = new Date(
      Math.max(subStart.getTime(), fromObj.getTime())
    );
    monthStart.setDate(1);
    const monthEnd = new Date(Math.min(subEnd.getTime(), toDateObj.getTime()));
    for (
      let y = monthStart.getFullYear(), mo = monthStart.getMonth();
      y < monthEnd.getFullYear() ||
      (y === monthEnd.getFullYear() && mo <= monthEnd.getMonth());
    ) {
      const period = `${y}-${String(mo + 1).padStart(2, "0")}`;
      monthlyMrr[period] = (monthlyMrr[period] || 0) + mrrNum;
      mo++;
      if (mo > 11) {
        mo = 0;
        y++;
      }
    }
  }

  const historicalData = Object.entries(monthlyMrr)
    .map(([period, value]) => ({ period: `${period}-01`, value }))
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: parseFloat(mrr.toFixed(2)),
    historicalData,
  };
}
