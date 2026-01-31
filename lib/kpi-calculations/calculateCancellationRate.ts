import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateCancellationRate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  // Get company ID
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (companyError || !company) {
    throw new Error("Company not found");
  }

  // Get bookings data from model_data
  const { data: bookingsData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "bookings");

  if (error || !(bookingsData as any)?.data) {
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data
  const bookings = (bookingsData as any).data.flatMap(
    (row: any) => row.data || []
  );

  // Get classes data to get dates
  const { data: classesData } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "classes");

  const classes =
    (classesData as any)?.data?.flatMap((row: any) => row.data || []) || [];
  const classLookup = new Map(classes.map((cls: any) => [cls.id, cls]));

  // Group by month and calculate cancellation rate
  // Assuming 'cancelled' is a different status from 'no_show'
  const monthlyStats: { [key: string]: { total: number; cancelled: number } } =
    {};

  bookings.forEach((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData || !(classData as any).date_time) return;

    const bookingDate = new Date((classData as any).date_time);
    if (bookingDate >= new Date(fromDate) && bookingDate < new Date(toDate)) {
      const period = bookingDate.toISOString().substring(0, 7);

      if (!monthlyStats[period]) {
        monthlyStats[period] = { total: 0, cancelled: 0 };
      }

      monthlyStats[period].total++;

      // Assuming cancelled is different from no_show
      if (booking.attendance_status === "cancelled") {
        monthlyStats[period].cancelled++;
      }
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period: `${period}-01`,
      value: stats.total > 0 ? (stats.cancelled / stats.total) * 100 : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
