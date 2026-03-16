import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import {
  ecomCustomerAcc,
  ecomOrderAcc,
  ecomOrderItemAcc,
  toPeriod,
} from "./ecomFieldAccessors";

/**
 * Growth Quality Score: composite 0–100 from revenue growth, new customer growth, and margin.
 * Uses current vs prior period of same length. Score = weighted sum normalized to 0–100:
 * - Revenue growth (vs prior period) → up to 40 points
 * - New customer growth (vs prior period) → up to 40 points
 * - Margin % (contribution from product profitability) → up to 20 points
 */
export async function calculateGrowthQualityScore(
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

  const rangeMs = toObj.getTime() - fromObj.getTime();
  const priorTo = new Date(fromObj.getTime() - 1);
  const priorFrom = new Date(priorTo.getTime() - rangeMs);

  const orderIdsInRange = new Set<string>();
  const orderIdsPrior = new Set<string>();
  let currentRevenue = 0;
  let priorRevenue = 0;
  const revenueByPeriod: Record<string, number> = {};
  let currentNewCustomers = 0;
  let priorNewCustomers = 0;
  const newCustomersByPeriod: Record<string, number> = {};
  let currentRevItems = 0;
  let currentCostItems = 0;

  for (const o of data.orders) {
    const date = ecomOrderAcc.orderDate(o);
    if (!date) continue;
    const rev = ecomOrderAcc.totalRevenue(o);
    const period = toPeriod(date);
    revenueByPeriod[period] = (revenueByPeriod[period] ?? 0) + rev;
    if (date >= fromObj && date <= toObj) {
      orderIdsInRange.add(ecomOrderAcc.id(o));
      currentRevenue += rev;
    } else if (date >= priorFrom && date <= priorTo) {
      orderIdsPrior.add(ecomOrderAcc.id(o));
      priorRevenue += rev;
    }
  }

  for (const c of data.customers) {
    const date = ecomCustomerAcc.firstOrderDate(c);
    if (!date) continue;
    const period = toPeriod(date);
    newCustomersByPeriod[period] = (newCustomersByPeriod[period] ?? 0) + 1;
    if (date >= fromObj && date <= toObj) currentNewCustomers++;
    else if (date >= priorFrom && date <= priorTo) priorNewCustomers++;
  }

  for (const item of data.orderItems) {
    if (!orderIdsInRange.has(ecomOrderItemAcc.orderId(item))) continue;
    const qty = ecomOrderItemAcc.quantity(item);
    currentRevItems += qty * ecomOrderItemAcc.price(item);
    currentCostItems += qty * ecomOrderItemAcc.cost(item);
  }

  const revenueGrowthPct =
    priorRevenue > 0
      ? ((currentRevenue - priorRevenue) / priorRevenue) * 100
      : currentRevenue > 0
        ? 100
        : 0;
  const newCustomerGrowthPct =
    priorNewCustomers > 0
      ? ((currentNewCustomers - priorNewCustomers) / priorNewCustomers) * 100
      : currentNewCustomers > 0
        ? 100
        : 0;
  const marginPct =
    currentRevItems > 0
      ? ((currentRevItems - currentCostItems) / currentRevItems) * 100
      : 0;

  // Score: revenue growth capped at 40, customer growth at 40, margin at 20 (margin/5 so 20% margin = 4 points, 100% = 20)
  const revenueScore = Math.max(0, Math.min(40, 20 + revenueGrowthPct * 0.2));
  const customerScore = Math.max(
    0,
    Math.min(40, 20 + newCustomerGrowthPct * 0.2)
  );
  const marginScore = Math.max(0, Math.min(20, marginPct / 5));
  const currentValue = Math.round(
    Math.max(0, Math.min(100, revenueScore + customerScore + marginScore))
  );

  const periods = Object.keys(revenueByPeriod).sort();
  const historicalData = periods.map((period) => {
    const rev = revenueByPeriod[period] ?? 0;
    const nc = newCustomersByPeriod[period] ?? 0;
    const periodIdx = periods.indexOf(period);
    const prevPeriod = periodIdx > 0 ? periods[periodIdx - 1] : null;
    const prevRev = prevPeriod ? (revenueByPeriod[prevPeriod] ?? 0) : 0;
    const prevNc = prevPeriod ? (newCustomersByPeriod[prevPeriod] ?? 0) : 0;
    const revGrowth = prevRev > 0 ? ((rev - prevRev) / prevRev) * 100 : 0;
    const ncGrowth = prevNc > 0 ? ((nc - prevNc) / prevNc) * 100 : 0;
    const rs = Math.max(0, Math.min(40, 20 + revGrowth * 0.2));
    const cs = Math.max(0, Math.min(40, 20 + ncGrowth * 0.2));
    const ms = 10;
    const score = Math.max(0, Math.min(100, rs + cs + ms));
    return { period, value: Math.round(score) };
  });

  return { currentValue, historicalData };
}
