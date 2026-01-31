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

  // Create lookup maps for easier merging
  const churnedMap = new Map(
    churnedResult.historicalData.map((item) => [item.period, item.value])
  );
  const activeMap = new Map(
    activeResult.historicalData.map((item) => [item.period, item.value])
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

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
