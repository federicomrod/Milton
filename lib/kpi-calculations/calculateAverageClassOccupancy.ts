import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateAverageClassOccupancy(
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

  // Get classes and bookings data
  const [classesData, bookingsData] = await Promise.all([
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "classes"),
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "bookings"),
  ]);

  if (!(classesData as any)?.data || !(bookingsData as any)?.data) {
    return { currentValue: 0, historicalData: [] };
  }

  const classes = (classesData as any).data.flatMap(
    (row: any) => row.data || []
  );
  const bookings = (bookingsData as any).data.flatMap(
    (row: any) => row.data || []
  );

  // Group bookings by class
  const classBookings = new Map<string, any[]>();
  bookings.forEach((booking: any) => {
    if (!classBookings.has(booking.class_id)) {
      classBookings.set(booking.class_id, []);
    }
    classBookings.get(booking.class_id)!.push(booking);
  });

  // Calculate occupancy for each class
  const classOccupancy: { date: string; occupancy: number }[] = [];

  classes.forEach((cls: any) => {
    if (cls.date_time && cls.capacity && cls.capacity > 0) {
      const classDate = new Date(cls.date_time);
      if (classDate >= new Date(fromDate) && classDate < new Date(toDate)) {
        const bookingsForClass = classBookings.get(cls.id) || [];
        const attendedCount = bookingsForClass.filter(
          (b: any) => b.attendance_status === "attended"
        ).length;

        const occupancyRate = (attendedCount / cls.capacity) * 100;
        classOccupancy.push({
          date: cls.date_time,
          occupancy: occupancyRate,
        });
      }
    }
  });

  // Group by month and average occupancy
  const monthlyStats: { [key: string]: number[] } = {};

  classOccupancy.forEach(({ date, occupancy }) => {
    const period = new Date(date).toISOString().substring(0, 7);
    if (!monthlyStats[period]) {
      monthlyStats[period] = [];
    }
    monthlyStats[period].push(occupancy);
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, occupancies]) => ({
      period: `${period}-01`,
      value:
        occupancies.length > 0
          ? occupancies.reduce((sum, occ) => sum + occ, 0) / occupancies.length
          : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
