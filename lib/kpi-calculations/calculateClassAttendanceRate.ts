import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateClassAttendanceRate(
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

  // Filter bookings by date range
  const filteredBookings = bookings.filter((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData || !classData.date_time) {
      return false;
    }
    const bookingDate = new Date(classData.date_time);
    return bookingDate >= new Date(fromDate) && bookingDate < new Date(toDate);
  });

  // Calculate attendance rate by month
  // Formula: (attended bookings) / (attended + booked bookings) * 100
  const monthlyStats: { [key: string]: { attended: number; booked: number } } =
    {};

  filteredBookings.forEach((booking: any) => {
    const classData = classLookup.get(booking.class_id);
    if (!classData) return;

    const period = new Date(classData.date_time).toISOString().substring(0, 7);
    if (!monthlyStats[period]) {
      monthlyStats[period] = { attended: 0, booked: 0 };
    }

    if (booking.attendance_status === "attended") {
      monthlyStats[period].attended++;
    } else if (booking.attendance_status === "booked") {
      monthlyStats[period].booked++;
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => {
      const totalBooked = stats.attended + stats.booked;
      return {
        period: `${period}-01`,
        value: totalBooked > 0 ? (stats.attended / totalBooked) * 100 : 0,
      };
    })
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
