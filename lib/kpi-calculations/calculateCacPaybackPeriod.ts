import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import {
  ecomCustomerAcc,
  ecomOrderAcc,
  ecomMarketingAcc,
  toPeriod,
} from "./ecomFieldAccessors";

/**
 * CAC Payback Period (months to recover CAC from new-customer revenue).
 * Formula: CAC / (New Customer Revenue per month).
 * New Customer Revenue = sum of Total Revenue from orders where the customer's First Order Date is in period.
 * Revenue per new customer per month = New Customer Revenue / (New Customers × months in period); then Payback = CAC / that.
 * So: Payback (months) = CAC × New Customers × months_in_period / New Customer Revenue (when New Customer Revenue > 0).
 */
export async function calculateCacPaybackPeriod(
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

  const newCustomerIds = new Set<string>();
  for (const c of data.customers) {
    const date = ecomCustomerAcc.firstOrderDate(c);
    if (!date || date < fromObj || date > toObj) continue;
    newCustomerIds.add(ecomCustomerAcc.id(c));
  }
  const newCustomers = newCustomerIds.size;

  let newCustomerRevenue = 0;
  const revenueByPeriod: Record<string, number> = {};
  for (const o of data.orders) {
    if (!newCustomerIds.has(ecomOrderAcc.customerId(o))) continue;
    const date = ecomOrderAcc.orderDate(o);
    if (!date || date < fromObj || date > toObj) continue;
    const rev = ecomOrderAcc.totalRevenue(o);
    newCustomerRevenue += rev;
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

  const monthsInRange =
    (toObj.getTime() - fromObj.getTime()) / (30.44 * 24 * 60 * 60 * 1000);
  const monthsNum = Math.max(monthsInRange, 1 / 12);

  const cac = newCustomers > 0 ? totalSpend / newCustomers : 0;
  const revenuePerNewCustomerPerMonth =
    newCustomers > 0 ? newCustomerRevenue / newCustomers / monthsNum : 0;
  const currentValue =
    revenuePerNewCustomerPerMonth > 0 && cac > 0
      ? parseFloat((cac / revenuePerNewCustomerPerMonth).toFixed(2))
      : 0;

  const allPeriods = new Set<string>([
    ...Object.keys(revenueByPeriod),
    ...Object.keys(spendByPeriod),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const rev = revenueByPeriod[period] ?? 0;
    const spend = spendByPeriod[period] ?? 0;
    const nc = data.customers.filter((c) => {
      const d = ecomCustomerAcc.firstOrderDate(c);
      return d && toPeriod(d) === period;
    }).length;
    const periodCac = nc > 0 ? spend / nc : 0;
    const revPerCustPerMonth = nc > 0 ? rev / nc : 0;
    const payback =
      revPerCustPerMonth > 0 && periodCac > 0
        ? periodCac / revPerCustPerMonth
        : 0;
    return { period, value: parseFloat(payback.toFixed(2)) };
  });

  return { currentValue, historicalData };
}
