import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { classAcc, bookingAcc, toPeriod } from "./fieldAccessors";

export async function calculateAverageClassSize(
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

  // Count attended bookings per class ID
  const attendedPerClass = new Map<string, number>();
  bookings.forEach((b: any) => {
    if (bookingAcc.attendanceStatus(b) !== "attended") return;
    const cid = bookingAcc.classId(b);
    attendedPerClass.set(cid, (attendedPerClass.get(cid) ?? 0) + 1);
  });

  const from = new Date(fromDate);
  const to = new Date(toDate);
  const monthlyStats: Record<string, number[]> = {};

  classes.forEach((c: any) => {
    const dt = classAcc.dateTime(c);
    if (!dt || dt < from || dt >= to) return;

    const cid = classAcc.id(c);
    const attended = attendedPerClass.get(cid) ?? 0;
    if (attended === 0) return; // skip classes with no attendees

    const period = toPeriod(dt);
    if (!monthlyStats[period]) monthlyStats[period] = [];
    monthlyStats[period].push(attended);
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, counts]) => ({
      period,
      value:
        counts.length > 0
          ? counts.reduce((s, c) => s + c, 0) / counts.length
          : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
