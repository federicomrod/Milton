import { SupabaseClient } from "@supabase/supabase-js";
import { calculateTotalRevenue } from "./calculateTotalRevenue";
import { calculateCovers } from "./calculateCovers";

export async function calculateAverageTicketSize(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  // Calculate from Total Revenue and Covers
  const [revenueResult, coversResult] = await Promise.all([
    calculateTotalRevenue(supabase, userId, fromDate, toDate),
    calculateCovers(supabase, userId, fromDate, toDate),
  ]);

  const totalRevenue = revenueResult.currentValue;
  const totalCovers = coversResult.currentValue;
  const averageTicketSize = totalCovers > 0 ? totalRevenue / totalCovers : 0;

  // Calculate historical data by combining revenue and covers monthly data
  const revenueByPeriod = new Map(
    revenueResult.historicalData.map((d) => [d.period, d.value])
  );
  const coversByPeriod = new Map(
    coversResult.historicalData.map((d) => [d.period, d.value])
  );

  const allPeriods = new Set([
    ...revenueResult.historicalData.map((d) => d.period),
    ...coversResult.historicalData.map((d) => d.period),
  ]);

  const historicalData = Array.from(allPeriods)
    .map((period) => {
      const revenue = revenueByPeriod.get(period) || 0;
      const covers = coversByPeriod.get(period) || 0;
      const avgTicket = covers > 0 ? revenue / covers : 0;
      return {
        period,
        value: parseFloat(avgTicket.toFixed(2)),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  return {
    currentValue: parseFloat(averageTicketSize.toFixed(2)),
    historicalData,
  };
}
