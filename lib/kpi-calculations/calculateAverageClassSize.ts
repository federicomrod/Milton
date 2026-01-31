import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateAverageClassSize(
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

  // Group attendees by class
  const classAttendeeCounts: {
    [key: string]: { attendees: number; date: string };
  } = {};

  bookings.forEach((booking: any) => {
    if (booking.attendance_status === "attended") {
      const classId = booking.class_id;
      const classData = classLookup.get(classId);

      if (classData && classData.date_time) {
        const key = `${classId}-${classData.date_time}`;
        if (!classAttendeeCounts[key]) {
          classAttendeeCounts[key] = {
            attendees: 0,
            date: classData.date_time,
          };
        }
        classAttendeeCounts[key].attendees++;
      }
    }
  });

  // Calculate average by month
  const monthlyStats: { [key: string]: number[] } = {};

  Object.values(classAttendeeCounts).forEach(({ attendees, date }) => {
    const period = new Date(date).toISOString().substring(0, 7);
    if (!monthlyStats[period]) {
      monthlyStats[period] = [];
    }
    monthlyStats[period].push(attendees);
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, attendeeCounts]) => ({
      period: `${period}-01`,
      value:
        attendeeCounts.length > 0
          ? attendeeCounts.reduce((sum, count) => sum + count, 0) /
            attendeeCounts.length
          : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
