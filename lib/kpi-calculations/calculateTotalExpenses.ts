import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { txAcc, toPeriod } from "./fieldAccessors";

export async function calculateTotalExpenses(
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
  const monthlyOutflows: Record<string, number> = {};

  transactions.forEach((t: any) => {
    const txDate = txAcc.date(t);
    const amount = txAcc.amount(t);
    const type = txAcc.type(t);
    if (!txDate || type !== "outflow") return;
    if (txDate < from || txDate >= to) return;

    const period = toPeriod(txDate);
    monthlyOutflows[period] = (monthlyOutflows[period] ?? 0) + amount;
  });

  const historicalData = Object.entries(monthlyOutflows)
    .map(([period, value]) => ({ period, value }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
