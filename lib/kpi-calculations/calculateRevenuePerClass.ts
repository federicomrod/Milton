import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { classAcc, txAcc, toPeriod } from "./fieldAccessors";

export async function calculateRevenuePerClass(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) throw new Error("Company not found");

  const [transactions, classes] = await Promise.all([
    getModelDataRows(supabase, company.id, "transactions"),
    getModelDataRows(supabase, company.id, "classes"),
  ]);

  const from = new Date(fromDate);
  const to = new Date(toDate);

  const monthlyRevenue: Record<string, number> = {};
  transactions.forEach((t: any) => {
    const txDate = txAcc.date(t);
    const amount = txAcc.amount(t);
    const type = txAcc.type(t);
    if (!txDate || amount <= 0 || type !== "inflow") return;
    if (txDate < from || txDate >= to) return;
    const period = toPeriod(txDate);
    monthlyRevenue[period] = (monthlyRevenue[period] ?? 0) + amount;
  });

  const monthlyClasses: Record<string, number> = {};
  classes.forEach((c: any) => {
    const dt = classAcc.dateTime(c);
    if (!dt || dt < from || dt >= to) return;
    const period = toPeriod(dt);
    monthlyClasses[period] = (monthlyClasses[period] ?? 0) + 1;
  });

  const allPeriods = new Set([
    ...Object.keys(monthlyRevenue),
    ...Object.keys(monthlyClasses),
  ]);

  const historicalData = Array.from(allPeriods)
    .map((period) => ({
      period,
      value:
        (monthlyClasses[period] ?? 0) > 0
          ? (monthlyRevenue[period] ?? 0) / monthlyClasses[period]
          : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
