import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateTotalClassesHeld(
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

  // Get classes data from model_data
  const { data: classesData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "classes");

  if (error || !classesData) {
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data
  const classes = (classesData as any).data.flatMap(
    (row: any) => row.data || []
  );

  // Group by month and count classes
  const monthlyStats: { [key: string]: number } = {};

  classes.forEach((cls: any) => {
    if (cls.date_time) {
      const classDate = new Date(cls.date_time);
      const period = classDate.toISOString().substring(0, 7); // YYYY-MM

      // Only count if class date is within our range
      if (classDate >= new Date(fromDate) && classDate < new Date(toDate)) {
        if (!monthlyStats[period]) {
          monthlyStats[period] = 0;
        }
        monthlyStats[period]++;
      }
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, count]) => ({
      period: `${period}-01`,
      value: count,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
