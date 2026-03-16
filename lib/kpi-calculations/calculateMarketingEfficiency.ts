import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import { ecomOrderAcc, ecomMarketingAcc, toPeriod } from "./ecomFieldAccessors";

/**
 * Marketing Efficiency (Revenue / Marketing Spend, e.g. ROAS).
 * Formula: Total Revenue (in period) / Total Marketing Spend (in period).
 * Card: single ratio; chart: ratio by month.
 */
export async function calculateMarketingEfficiency(
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

  if (!company) return { currentValue: 0, historicalData: [] };

  const data = await getEcomModelData(supabase, company.id);
  const fromObj = new Date(fromDate + "T00:00:00");
  const toObj = new Date(toDate + "T23:59:59");

  let totalRevenue = 0;
  const revenueByPeriod: Record<string, number> = {};
  for (const o of data.orders) {
    const date = ecomOrderAcc.orderDate(o);
    if (!date || date < fromObj || date > toObj) continue;
    const rev = ecomOrderAcc.totalRevenue(o);
    totalRevenue += rev;
    const period = toPeriod(date);
    revenueByPeriod[period] = (revenueByPeriod[period] ?? 0) + rev;
  }

  let totalSpend = 0;
  const spendByPeriod: Record<string, number> = {};
  for (const m of data.marketingSpend) {
    const date = ecomMarketingAcc.date(m);
    if (!date || date < fromObj || date > toObj) continue;
    const spend = ecomMarketingAcc.spend(m);
    totalSpend += spend;
    const period = toPeriod(date);
    spendByPeriod[period] = (spendByPeriod[period] ?? 0) + spend;
  }

  const currentValue =
    totalSpend > 0 ? parseFloat((totalRevenue / totalSpend).toFixed(2)) : 0;

  const allPeriods = new Set<string>([
    ...Object.keys(revenueByPeriod),
    ...Object.keys(spendByPeriod),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const rev = revenueByPeriod[period] ?? 0;
    const spend = spendByPeriod[period] ?? 0;
    const ratio = spend > 0 ? rev / spend : 0;
    return { period, value: parseFloat(ratio.toFixed(2)) };
  });

  return { currentValue, historicalData };
}
