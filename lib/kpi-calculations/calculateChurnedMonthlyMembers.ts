import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateChurnedMonthlyMembers(
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

  // Get members data from model_data
  const { data: membersData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "members");

  if (error || !membersData) {
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data
  const members = membersData.flatMap((row: any) => row.data || []);

  // Group by month and count churned members (cancel_date in that month)
  const monthlyStats: { [key: string]: number } = {};

  members.forEach((member: any) => {
    if (member.cancel_date) {
      const cancelDate = new Date(member.cancel_date);
      const period = cancelDate.toISOString().substring(0, 7); // YYYY-MM

      // Only count if cancel date is within our range
      if (cancelDate >= new Date(fromDate) && cancelDate < new Date(toDate)) {
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
