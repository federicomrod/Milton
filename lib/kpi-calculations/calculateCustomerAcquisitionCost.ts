import type { SupabaseClient } from "@supabase/supabase-js";
import { getEcomModelData } from "./ecomDataLoader";
import {
  ecomCustomerAcc,
  ecomMarketingAcc,
  toPeriod,
} from "./ecomFieldAccessors";

/**
 * Customer Acquisition Cost (CAC).
 * Formula: Total Marketing Spend (in period) / New Customers (in period).
 * New customers = count of E-Com Customers where First Order Date is in [fromDate, toDate].
 */
export async function calculateCustomerAcquisitionCost(
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

  let newCustomers = 0;
  const newCustomersByPeriod: Record<string, number> = {};
  for (const c of data.customers) {
    const date = ecomCustomerAcc.firstOrderDate(c);
    if (!date || date < fromObj || date > toObj) continue;
    newCustomers++;
    const period = toPeriod(date);
    newCustomersByPeriod[period] = (newCustomersByPeriod[period] ?? 0) + 1;
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
    newCustomers > 0 ? parseFloat((totalSpend / newCustomers).toFixed(2)) : 0;

  const allPeriods = new Set<string>([
    ...Object.keys(newCustomersByPeriod),
    ...Object.keys(spendByPeriod),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const spend = spendByPeriod[period] ?? 0;
    const nc = newCustomersByPeriod[period] ?? 0;
    const cac = nc > 0 ? spend / nc : 0;
    return { period, value: parseFloat(cac.toFixed(2)) };
  });

  return { currentValue, historicalData };
}
