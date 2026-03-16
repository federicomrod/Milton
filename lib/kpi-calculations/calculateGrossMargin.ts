import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { txAcc, toPeriod, readField } from "./fieldAccessors";

function isCOGS(category: string): boolean {
  const c = (category ?? "").toLowerCase();
  return (
    /cogs|cost of goods|direct cost|direct costs|cost of sales/i.test(c) ||
    c === "cogs"
  );
}

/**
 * Gross Margin % = (Revenue - COGS) / Revenue * 100.
 * Uses transactions: positive = revenue, negative with COGS-like category = COGS.
 */
export async function calculateGrossMargin(
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

  if (!transactions.length)
    return { currentValue: null as number | null, historicalData: [] };

  const from = new Date(fromDate);
  const to = new Date(toDate);
  let revenue = 0;
  let cogs = 0;
  const monthlyRevenue: Record<string, number> = {};
  const monthlyCogs: Record<string, number> = {};

  transactions.forEach((t: any) => {
    const txDate = txAcc.date(t);
    const amount = txAcc.amount(t);
    const type = txAcc.type(t);
    if (!txDate || txDate < from || txDate >= to) return;

    const period = toPeriod(txDate);
    const isInflow = type === "inflow" || amount > 0;
    if (isInflow) {
      revenue += amount;
      monthlyRevenue[period] = (monthlyRevenue[period] ?? 0) + amount;
    } else {
      const category = readField(t, "category", "Category", "type") ?? "";
      const absAmount = Math.abs(amount);
      if (isCOGS(category)) {
        cogs += absAmount;
        monthlyCogs[period] = (monthlyCogs[period] ?? 0) + absAmount;
      }
    }
  });

  const currentValue =
    revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 100) : 0;
  const allPeriods = new Set([
    ...Object.keys(monthlyRevenue),
    ...Object.keys(monthlyCogs),
  ]);
  const historicalData = [...allPeriods].sort().map((period) => {
    const r = monthlyRevenue[period] ?? 0;
    const c = monthlyCogs[period] ?? 0;
    const pct = r > 0 ? Math.round(((r - c) / r) * 100) : 0;
    return { period: `${period}-01`, value: pct };
  });

  return { currentValue, historicalData };
}
