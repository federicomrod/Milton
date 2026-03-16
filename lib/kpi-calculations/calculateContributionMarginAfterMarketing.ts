import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import {
  ecomOrderAcc,
  ecomOrderItemAcc,
  ecomMarketingAcc,
  toPeriod,
} from "./ecomFieldAccessors";

/**
 * Contribution Margin after Marketing (CMAM).
 * Formula: (Total Revenue - COGS - Marketing Spend) / Total Revenue × 100.
 * Uses E-Com Orders (Total Revenue), E-Com Order Items (Cost × Quantity for orders in period), E-Com Marketing Spend (Spend).
 */
export async function calculateContributionMarginAfterMarketing(
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

  const orderIdsInRange = new Set<string>();
  const revenueByPeriod: Record<string, number> = {};
  let totalRevenue = 0;

  for (const o of data.orders) {
    const date = ecomOrderAcc.orderDate(o);
    if (!date || date < fromObj || date > toObj) continue;
    const rev = ecomOrderAcc.totalRevenue(o);
    orderIdsInRange.add(ecomOrderAcc.id(o));
    totalRevenue += rev;
    const period = toPeriod(date);
    revenueByPeriod[period] = (revenueByPeriod[period] ?? 0) + rev;
  }

  let cogs = 0;
  const cogsByPeriod: Record<string, number> = {};
  for (const item of data.orderItems) {
    if (!orderIdsInRange.has(ecomOrderItemAcc.orderId(item))) continue;
    const qty = ecomOrderItemAcc.quantity(item);
    const cost = ecomOrderItemAcc.cost(item);
    const lineCogs = qty * cost;
    cogs += lineCogs;
    const order = data.orders.find(
      (o) => ecomOrderAcc.id(o) === ecomOrderItemAcc.orderId(item)
    );
    if (order) {
      const date = ecomOrderAcc.orderDate(order);
      if (date) {
        const period = toPeriod(date);
        cogsByPeriod[period] = (cogsByPeriod[period] ?? 0) + lineCogs;
      }
    }
  }

  let marketingSpend = 0;
  const marketingByPeriod: Record<string, number> = {};
  for (const m of data.marketingSpend) {
    const date = ecomMarketingAcc.date(m);
    if (!date || date < fromObj || date > toObj) continue;
    const spend = ecomMarketingAcc.spend(m);
    marketingSpend += spend;
    const period = toPeriod(date);
    marketingByPeriod[period] = (marketingByPeriod[period] ?? 0) + spend;
  }

  const contributionAfterMarketing = totalRevenue - cogs - marketingSpend;
  const currentValue =
    totalRevenue > 0
      ? parseFloat(
          ((contributionAfterMarketing / totalRevenue) * 100).toFixed(2)
        )
      : 0;

  const allPeriods = new Set<string>([
    ...Object.keys(revenueByPeriod),
    ...Object.keys(cogsByPeriod),
    ...Object.keys(marketingByPeriod),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const rev = revenueByPeriod[period] ?? 0;
    const c = cogsByPeriod[period] ?? 0;
    const mkt = marketingByPeriod[period] ?? 0;
    const cmam = rev > 0 ? ((rev - c - mkt) / rev) * 100 : 0;
    return { period, value: parseFloat(cmam.toFixed(2)) };
  });

  return { currentValue, historicalData };
}
