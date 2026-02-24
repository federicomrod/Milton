import { SupabaseClient } from "@supabase/supabase-js";
import { calculateChurnedMonthlyMembers } from "./calculateChurnedMonthlyMembers";
import { calculateActiveMembers } from "./calculateActiveMembers";

export async function calculateMonthlyChurnRate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  // Get both churned members and active members data
  const [churnedResult, activeResult] = await Promise.all([
    calculateChurnedMonthlyMembers(supabase, userId, fromDate, toDate),
    calculateActiveMembers(supabase, userId, fromDate, toDate),
  ]);

  // Normalize periods to "YYYY-MM" — churned returns "YYYY-MM-01", active returns "YYYY-MM"
  const normalizePeriod = (p: string) => p.substring(0, 7);

  const churnedMap = new Map(
    churnedResult.historicalData.map((item) => [
      normalizePeriod(item.period),
      item.value,
    ])
  );
  const activeMap = new Map(
    activeResult.historicalData.map((item) => [
      normalizePeriod(item.period),
      item.value,
    ])
  );

  // Get all unique periods
  const allPeriods = new Set([...churnedMap.keys(), ...activeMap.keys()]);

  const historicalData = Array.from(allPeriods)
    .map((period) => {
      const churned = churnedMap.get(period) || 0;
      const active = activeMap.get(period) || 0;
      return {
        period,
        value: active > 0 ? (churned / active) * 100 : 0,
      };
    })
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
