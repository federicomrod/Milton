import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { memberAcc, toPeriod } from "./fieldAccessors";

export async function calculateChurnedMonthlyMembers(
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

  const members = await getModelDataRows(
    supabase,
    company.id,
    "members",
    "customers"
  );

  const from = new Date(fromDate);
  const to = new Date(toDate);
  const monthlyStats: Record<string, number> = {};

  members.forEach((m: any) => {
    const cancelDate =
      memberAcc.cancelDate(m) ??
      (memberAcc.status(m) === "cancelled"
        ? memberAcc.statusChangeDate(m)
        : null);

    if (cancelDate && cancelDate >= from && cancelDate < to) {
      const period = toPeriod(cancelDate);
      monthlyStats[period] = (monthlyStats[period] ?? 0) + 1;
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, count]) => ({ period, value: count }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
