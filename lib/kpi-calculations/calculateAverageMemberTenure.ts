import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { memberAcc } from "./fieldAccessors";

export async function calculateAverageMemberTenure(
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

  const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

  const historicalData = months.map((month) => {
    const monthEnd = new Date(
      month.getFullYear(),
      month.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    const tenures = members
      .filter((m: any) => {
        const joinDate = memberAcc.joinDate(m);
        const cancelDate = memberAcc.cancelDate(m);
        if (!joinDate) return false;
        return joinDate <= monthEnd && (!cancelDate || cancelDate > monthEnd);
      })
      .map((m: any) => {
        const joinMs = memberAcc.joinDate(m)!.getTime();
        return (monthEnd.getTime() - joinMs) / MS_PER_MONTH;
      });

    const avg =
      tenures.length > 0
        ? tenures.reduce((s: number, v: number) => s + v, 0) / tenures.length
        : 0;

    const y = month.getFullYear();
    const mo = String(month.getMonth() + 1).padStart(2, "0");
    return { period: `${y}-${mo}`, value: avg };
  });

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
