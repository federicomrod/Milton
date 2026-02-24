import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { txAcc, toPeriod } from "./fieldAccessors";

export async function calculateBurnRate(
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

  const transactions = await getModelDataRows(
    supabase,
    company.id,
    "transactions",
    "transaction"
  );

  if (!transactions.length) return { currentValue: 0, historicalData: [] };

  const from = new Date(fromDate);
  const to = new Date(toDate);
  const monthlyStats: Record<string, { inflows: number; outflows: number }> =
    {};

  transactions.forEach((t: any) => {
    const txDate = txAcc.date(t);
    const amount = txAcc.amount(t);
    const type = txAcc.type(t);
    if (!txDate || !type) return;
    if (txDate < from || txDate >= to) return;

    const period = toPeriod(txDate);
    if (!monthlyStats[period])
      monthlyStats[period] = { inflows: 0, outflows: 0 };

    if (type === "inflow") monthlyStats[period].inflows += amount;
    else if (type === "outflow") monthlyStats[period].outflows += amount;
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period,
      value: stats.outflows - stats.inflows,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const totalBurn = historicalData.reduce((s, d) => s + d.value, 0);
  const currentValue =
    historicalData.length > 0 ? totalBurn / historicalData.length : 0;

  return { currentValue, historicalData };
}
