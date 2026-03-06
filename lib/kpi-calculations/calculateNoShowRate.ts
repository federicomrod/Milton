import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { classAcc, bookingAcc, toPeriod } from "./fieldAccessors";

export async function calculateNoShowRate(
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

  const [bookings, classes] = await Promise.all([
    getModelDataRows(supabase, company.id, "bookings"),
    getModelDataRows(supabase, company.id, "classes"),
  ]);

  const classLookup = new Map(classes.map((c: any) => [classAcc.id(c), c]));

  const from = new Date(fromDate);
  const to = new Date(toDate);
  // no_show / (attended + no_show) per month
  const monthlyStats: Record<string, { attended: number; noShows: number }> =
    {};

  bookings.forEach((b: any) => {
    const classData = classLookup.get(bookingAcc.classId(b));
    if (!classData) return;
    const dt = classAcc.dateTime(classData);
    if (!dt || dt < from || dt >= to) return;

    const status = bookingAcc.attendanceStatus(b);
    if (status !== "attended" && status !== "no_show") return;

    const period = toPeriod(dt);
    if (!monthlyStats[period])
      monthlyStats[period] = { attended: 0, noShows: 0 };
    if (status === "attended") monthlyStats[period].attended += 1;
    else monthlyStats[period].noShows += 1;
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => {
      const denom = stats.attended + stats.noShows;
      return {
        period,
        value: denom > 0 ? (stats.noShows / denom) * 100 : 0,
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
