import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateAverageTicketSize } from "./calculateAverageTicketSize";
import { aovFromCapturedOrdersWithHistorical } from "./aovFromCapturedOrders";

function getPeriodsInRange(fromDate: string, toDate: string): string[] {
  const [fromYear, fromMonth] = fromDate.split("-").map(Number);
  const [toYear, toMonth] = toDate.split("-").map(Number);
  const periods: string[] = [];
  for (
    let d = new Date(fromYear, fromMonth - 1, 1);
    d <= new Date(toYear, toMonth - 1, 1);
    d.setMonth(d.getMonth() + 1)
  ) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    periods.push(`${y}-${m}`);
  }
  return periods;
}

/**
 * Average Order Value (AOV).
 * Primary: Total Revenue / Covers from orders (same as Average Ticket Size).
 * Fallback when that is 0: Sum of Captured order totals / Number of Captured orders.
 * When we have a currentValue but no per-period data, returns one point per month (flat line) so charts work.
 */
export async function calculateAverageOrderValue(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
): Promise<{
  currentValue: number;
  historicalData: { period: string; value: number }[];
}> {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    return { currentValue: 0, historicalData: [] };
  }

  let currentValue = 0;
  let historicalData: { period: string; value: number }[] = [];

  try {
    const ticketResult = await calculateAverageTicketSize(
      supabase,
      userId,
      fromDate,
      toDate
    );
    currentValue = ticketResult.currentValue ?? 0;
    historicalData = ticketResult.historicalData || [];
  } catch (e) {
    // Primary path (revenue/covers) can throw e.g. "Company not found"; use fallback
    console.log(
      "[calculateAverageOrderValue] Primary path failed, using fallback:",
      e instanceof Error ? e.message : e
    );
  }

  if (currentValue === 0) {
    const fallback = await aovFromCapturedOrdersWithHistorical(
      supabase,
      company.id,
      fromDate,
      toDate
    );
    if (fallback.currentValue > 0) {
      currentValue = fallback.currentValue;
      historicalData = fallback.historicalData || [];
    }
  }

  const value = parseFloat(currentValue.toFixed(2));
  // Chart uses historicalData; if empty but we have a value, use flat line per month (same as other KPIs)
  if (value > 0 && historicalData.length === 0) {
    const periods = getPeriodsInRange(fromDate, toDate);
    historicalData = periods.map((period) => ({ period, value }));
    console.log(
      `[calculateAverageOrderValue] Synthetic historicalData: value=${value}, periods=${periods.length}`
    );
  }

  return {
    currentValue: value,
    historicalData,
  };
}
