import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { classAcc, toPeriod } from "./fieldAccessors";

export async function calculateTotalClassesHeld(
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

  const classes = await getModelDataRows(supabase, company.id, "classes");

  const from = new Date(fromDate);
  const to = new Date(toDate);
  const monthlyStats: Record<string, number> = {};

  classes.forEach((c: any) => {
    const dt = classAcc.dateTime(c);
    if (!dt || dt < from || dt >= to) return;
    const period = toPeriod(dt);
    monthlyStats[period] = (monthlyStats[period] ?? 0) + 1;
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
