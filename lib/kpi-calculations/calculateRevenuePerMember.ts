import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { memberAcc, txAcc, toPeriod } from "./fieldAccessors";

export async function calculateRevenuePerMember(
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

  const [transactions, members] = await Promise.all([
    getModelDataRows(supabase, company.id, "transactions"),
    getModelDataRows(supabase, company.id, "members", "customers"),
  ]);

  const from = new Date(fromDate);
  const to = new Date(toDate);

  // Monthly revenue (inflows only)
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

  // Active members per month-end
  const monthlyActiveMembers: Record<string, number> = {};
  Object.keys(monthlyRevenue).forEach((period) => {
    const [y, mo] = period.split("-").map(Number);
    const monthEnd = new Date(y, mo, 0, 23, 59, 59);
    monthlyActiveMembers[period] = members.filter((m: any) => {
      const joinDate = memberAcc.joinDate(m);
      const cancelDate = memberAcc.cancelDate(m);
      if (!joinDate) return false;
      return joinDate <= monthEnd && (!cancelDate || cancelDate > monthEnd);
    }).length;
  });

  const historicalData = Object.entries(monthlyRevenue)
    .map(([period, revenue]) => ({
      period,
      value:
        (monthlyActiveMembers[period] ?? 0) > 0
          ? revenue / monthlyActiveMembers[period]
          : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
