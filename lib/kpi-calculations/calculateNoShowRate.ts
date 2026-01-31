import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateNoShowRate(
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

  // Get bookings and classes data from model_data
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

  if (!bookingsData.data || !classesData.data) {
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data arrays
  const bookings = bookingsData.data.flatMap((row: any) => row.data || []);
  const classes = classesData.data.flatMap((row: any) => row.data || []);

  // Create class lookup by ID
  const classLookup = new Map(classes.map((cls: any) => [cls.id, cls]));

  // Filter bookings by date range
  const filteredBookings = bookings.filter((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData || !classData.date_time) {
      return false;
    }
    const bookingDate = new Date(classData.date_time);
    return bookingDate >= new Date(fromDate) && bookingDate < new Date(toDate);
  });

  // Group by month and calculate no-show rate
  const monthlyStats: { [key: string]: { total: number; noShows: number } } =
    {};

  filteredBookings.forEach((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData) return;

    const period = new Date(classData.date_time).toISOString().substring(0, 7);
    if (!monthlyStats[period]) {
      monthlyStats[period] = { total: 0, noShows: 0 };
    }
    monthlyStats[period].total++;
    if (booking.attendance_status === "no_show") {
      monthlyStats[period].noShows++;
    }
  });

  // Calculate rates
  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period: `${period}-01`,
      value: stats.total > 0 ? (stats.noShows / stats.total) * 100 : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
