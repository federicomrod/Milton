import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateActiveMembers(
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

  // Generate series of months
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

  const historicalData = months.map((month) => {
    const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);

    // Count active members at end of month
    const activeCount = members.filter((member: any) => {
      const joinDate = new Date(member.join_date);
      const cancelDate = member.cancel_date
        ? new Date(member.cancel_date)
        : null;
      return joinDate <= monthEnd && (!cancelDate || cancelDate > monthEnd);
    }).length;

    return {
      period: month.toISOString().substring(0, 10),
      value: activeCount,
    };
  });

  const currentValue =
    historicalData.length > 0
      ? historicalData[historicalData.length - 1].value
      : 0;

  return { currentValue, historicalData };
}
