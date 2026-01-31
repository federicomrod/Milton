import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateUtilizationRate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  // Get company ID
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) throw new Error("Company not found");

  // Get bookings and classes data
  const [bookingsData, classesData] = await Promise.all([
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "bookings"),
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "classes"),
  ]);

  const bookings =
    bookingsData.data?.flatMap((row: any) => row.data || []) || [];
  const classes = classesData.data?.flatMap((row: any) => row.data || []) || [];

  // Create class lookup
  const classLookup = new Map(classes.map((cls: any) => [cls.id, cls]));

  // Calculate utilization by month
  const monthlyStats: { [key: string]: { booked: number; capacity: number } } =
    {};

  bookings.forEach((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData || !classData.date_time) return;

    const period = new Date(classData.date_time).toISOString().substring(0, 7);
    if (!monthlyStats[period]) {
      monthlyStats[period] = { booked: 0, capacity: 0 };
    }

    if (
      booking.attendance_status === "attended" ||
      booking.attendance_status === "booked"
    ) {
      monthlyStats[period].booked++;
    }

    if (classData.capacity) {
      monthlyStats[period].capacity += classData.capacity;
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period: `${period}-01`,
      value: stats.capacity > 0 ? (stats.booked / stats.capacity) * 100 : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
