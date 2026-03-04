import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { txAcc, toPeriod } from "./fieldAccessors";

function getTxDirection(t: any): "inflow" | "outflow" | "unknown" {
  // Look for direction field (e.g. "Direction (inflow / outflow)")
  const dirRaw =
    t["Direction (inflow / outflow)"] ??
    t.direction ??
    t.type ??
    t.Direction ??
    "";
  const dir = String(dirRaw || "").toLowerCase();

  if (
    dir.includes("outflow") ||
    dir === "out" ||
    dir === "expense" ||
    dir === "debit"
  ) {
    return "outflow";
  }
  if (
    dir.includes("inflow") ||
    dir === "in" ||
    dir === "revenue" ||
    dir === "credit"
  ) {
    return "inflow";
  }

  // Fallback: use negative amounts for outflows (legacy data without direction field)
  const amount = txAcc.amount(t);
  if (amount < 0) {
    return "outflow";
  }
  if (amount > 0) {
    return "inflow";
  }

  return "unknown";
}

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
    const amount = Math.abs(txAcc.amount(t)); // Use absolute value since direction determines flow
    if (!txDate) return;
    if (txDate < from || txDate >= to) return;

    const period = toPeriod(txDate);
    if (!monthlyStats[period])
      monthlyStats[period] = { inflows: 0, outflows: 0 };

    const direction = getTxDirection(t);
    if (direction === "inflow") monthlyStats[period].inflows += amount;
    else if (direction === "outflow") monthlyStats[period].outflows += amount;
    // Skip unknown direction transactions
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period,
      value: stats.outflows, // Burn rate = outflows only (not net cash flow)
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const totalBurn = historicalData.reduce((s, d) => s + d.value, 0);
  const currentValue = totalBurn; // Total burn rate for the period, not average

  return { currentValue, historicalData };
}
