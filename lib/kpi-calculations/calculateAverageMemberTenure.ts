import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateAverageMemberTenure(
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

  // Calculate tenure for each member (in months)
  const tenures: number[] = [];

  members.forEach((member: any) => {
    if (member.join_date) {
      const joinDate = new Date(member.join_date);
      const endDate = member.cancel_date
        ? new Date(member.cancel_date)
        : new Date(); // Use current date if still active

      if (endDate >= joinDate) {
        const tenureMs = endDate.getTime() - joinDate.getTime();
        const tenureMonths = tenureMs / (1000 * 60 * 60 * 24 * 30.44); // Average days per month
        tenures.push(tenureMonths);
      }
    }
  });

  // Calculate average tenure (this is a single value, not time-series)
  const averageTenure =
    tenures.length > 0
      ? tenures.reduce((sum, tenure) => sum + tenure, 0) / tenures.length
      : 0;

  // For historical data, we'll show the same value for each month in range
  // (since tenure is calculated across all members)
  const startDate = new Date(fromDate);
  const endDate = new Date(toDate);
  const months = [];

  for (
    let d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    d < endDate;
    d.setMonth(d.getMonth() + 1)
  ) {
    months.push(new Date(d));
  }

  const historicalData = months.map((month) => ({
    period: month.toISOString().substring(0, 10),
    value: averageTenure,
  }));

  return { currentValue: averageTenure, historicalData };
}
