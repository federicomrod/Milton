import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import { ecomOrderAcc, ecomOrderItemAcc, toPeriod } from "./ecomFieldAccessors";

/**
 * Product Profitability: margin % from order items (Revenue - COGS) / Revenue.
 * Card: overall margin % for the period; chart: margin % by month.
 * Uses E-Com Order Items (Price, Cost, Quantity) joined to E-Com Orders for date.
 */
export async function calculateProductProfitability(
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

  const orderIdToPeriod: Record<string, string> = {};
  for (const o of data.orders) {
    const date = ecomOrderAcc.orderDate(o);
    if (!date || date < fromObj || date > toObj) continue;
    orderIdToPeriod[ecomOrderAcc.id(o)] = toPeriod(date);
  }

  let totalRevenue = 0;
  let totalCost = 0;
  const revenueByPeriod: Record<string, number> = {};
  const costByPeriod: Record<string, number> = {};

  for (const item of data.orderItems) {
    const period = orderIdToPeriod[ecomOrderItemAcc.orderId(item)];
    if (!period) continue;
    const qty = ecomOrderItemAcc.quantity(item);
    const price = ecomOrderItemAcc.price(item);
    const cost = ecomOrderItemAcc.cost(item);
    const lineRevenue = qty * price;
    const lineCost = qty * cost;
    totalRevenue += lineRevenue;
    totalCost += lineCost;
    revenueByPeriod[period] = (revenueByPeriod[period] ?? 0) + lineRevenue;
    costByPeriod[period] = (costByPeriod[period] ?? 0) + lineCost;
  }

  const grossProfit = totalRevenue - totalCost;
  const currentValue =
    totalRevenue > 0
      ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(2))
      : 0;

  const allPeriods = new Set<string>([
    ...Object.keys(revenueByPeriod),
    ...Object.keys(costByPeriod),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const rev = revenueByPeriod[period] ?? 0;
    const cost = costByPeriod[period] ?? 0;
    const marginPct = rev > 0 ? ((rev - cost) / rev) * 100 : 0;
    return { period, value: parseFloat(marginPct.toFixed(2)) };
  });

  return { currentValue, historicalData };
}
