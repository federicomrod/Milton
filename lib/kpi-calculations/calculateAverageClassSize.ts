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

  // Count filled spots (booked or attended) per class occurrence ID — same definition as classes-utilization API
  const filledPerClass = new Map<string, number>();
  bookings.forEach((b: any) => {
    const status = bookingAcc.attendanceStatus(b);
    if (status !== "attended" && status !== "booked") return;
    const cid = bookingAcc.classId(b);
    filledPerClass.set(cid, (filledPerClass.get(cid) ?? 0) + 1);
  });

  const from = new Date(fromDate);
  const toEnd = new Date(toDate);
  toEnd.setHours(23, 59, 59, 999); // include full end date like classes-utilization API
  const monthlyStats: Record<string, number[]> = {};

  classes.forEach((c: any) => {
    const dt = classAcc.dateTime(c);
    if (!dt || dt < from || dt > toEnd) return;

    const cid = classAcc.id(c);
    const filled = filledPerClass.get(cid) ?? 0;
    if (filled === 0) return; // skip occurrences with no filled spots

    const period = toPeriod(dt);
    if (!monthlyStats[period]) monthlyStats[period] = [];
    monthlyStats[period].push(filled);
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
