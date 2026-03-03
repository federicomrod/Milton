import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { txAcc, toPeriod } from "./fieldAccessors";

export async function calculateRunway(
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

  // Running balance over all transactions (not limited to range)
  let balance = 0;
  const sorted = transactions
    .filter((t: any) => txAcc.date(t) && txAcc.type(t))
    .sort(
      (a: any, b: any) => txAcc.date(a)!.getTime() - txAcc.date(b)!.getTime()
    );

  sorted.forEach((t: any) => {
    const amount = txAcc.amount(t);
    const type = txAcc.type(t);
    if (type === "inflow") balance += amount;
    else if (type === "outflow") balance -= amount;
  });

  // Monthly stats within range to calculate burn
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

  const monthlyNet = Object.values(monthlyStats).map(
    (s) => s.outflows - s.inflows
  );
  const burnRates = monthlyNet.filter((b) => b > 0).slice(-3);

  const avgBurn =
    burnRates.length > 0
      ? burnRates.reduce((s, b) => s + b, 0) / burnRates.length
      : 0;

  // When avgBurn <= 0 (positive cash flow), runway is effectively infinite.
  // Return a sentinel (e.g. 999) so the UI can show "∞" (cash-flow-analysis uses > 100).
  const runway = avgBurn > 0 ? Math.round(balance / avgBurn) : 999;

  // Parse year/month directly from ISO string — avoids UTC→local shift bugs
  const [fromYear, fromMonth] = fromDate.split("-").map(Number);
  const [toYear, toMonth] = toDate.split("-").map(Number);
  const months: Date[] = [];

  for (
    let d = new Date(fromYear, fromMonth - 1, 1);
    d < new Date(toYear, toMonth - 1, 1);
    d.setMonth(d.getMonth() + 1)
  ) {
    months.push(new Date(d));
  }

  const historicalData = months.map((month) => {
    const y = month.getFullYear();
    const m = String(month.getMonth() + 1).padStart(2, "0");
    return { period: `${y}-${m}`, value: runway };
  });

  return { currentValue: runway, historicalData };
}
