import { SupabaseClient } from "@supabase/supabase-js";
import { getModelDataRows } from "./getModelDataRows";
import { classAcc, bookingAcc, toPeriod } from "./fieldAccessors";

export async function calculateUtilizationRate(
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

  const [classes, bookings] = await Promise.all([
    getModelDataRows(supabase, company.id, "classes"),
    getModelDataRows(supabase, company.id, "bookings"),
  ]);

  const from = new Date(fromDate);
  const to = new Date(toDate);

  // Count attended+booked bookings per class, then aggregate by month
  const classBookingCounts = new Map<string, number>();
  bookings.forEach((b: any) => {
    const status = bookingAcc.attendanceStatus(b);
    if (status !== "attended" && status !== "booked") return;
    const cid = bookingAcc.classId(b);
    classBookingCounts.set(cid, (classBookingCounts.get(cid) ?? 0) + 1);
  });

  const monthlyStats: Record<string, { booked: number; capacity: number }> = {};

  classes.forEach((c: any) => {
    const dt = classAcc.dateTime(c);
    const cap = classAcc.capacity(c);
    if (!dt || cap <= 0) return;
    if (dt < from || dt >= to) return;

    const period = toPeriod(dt);
    if (!monthlyStats[period])
      monthlyStats[period] = { booked: 0, capacity: 0 };

    const cid = classAcc.id(c);
    monthlyStats[period].booked += classBookingCounts.get(cid) ?? 0;
    monthlyStats[period].capacity += cap;
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period,
      value: stats.capacity > 0 ? (stats.booked / stats.capacity) * 100 : 0,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
