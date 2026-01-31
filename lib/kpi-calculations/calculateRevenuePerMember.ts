import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateRevenuePerMember(
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

  // Get transactions and members data
  const [transactionsData, membersData] = await Promise.all([
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "transactions"),
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "members"),
  ]);

  const transactions =
    transactionsData.data?.flatMap((row: any) => row.data || []) || [];
  const members = membersData.data?.flatMap((row: any) => row.data || []) || [];

  // Calculate monthly revenue and active members
  const monthlyData: { [key: string]: { revenue: number; members: number } } =
    {};

  // Process transactions
  transactions.forEach((tx: any) => {
    if (tx.amount > 0 && tx.date) {
      const period = new Date(tx.date).toISOString().substring(0, 7);
      if (!monthlyData[period]) {
        monthlyData[period] = { revenue: 0, members: 0 };
      }
      monthlyData[period].revenue += tx.amount;
    }
  });

  // Process members (simplified - count all active members)
  const activeMembers = members.filter((member: any) => {
    const cancelDate = member.cancel_date ? new Date(member.cancel_date) : null;
    return !cancelDate || cancelDate > new Date();
  }).length;

  // Calculate ARPM for each month
  const historicalData = Object.entries(monthlyData)
    .map(([period, data]) => ({
      period: `${period}-01`,
      value: activeMembers > 0 ? data.revenue / activeMembers : 0,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
