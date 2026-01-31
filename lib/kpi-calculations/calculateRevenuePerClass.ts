import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateRevenuePerClass(
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

  // Get transactions and classes data
  const [transactionsData, classesData] = await Promise.all([
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "transactions"),
    supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "classes"),
  ]);

  if (!transactionsData.data || !classesData.data) {
    return { currentValue: 0, historicalData: [] };
  }

  const transactions = transactionsData.data.flatMap(
    (row: any) => row.data || []
  );
  const classes = classesData.data.flatMap((row: any) => row.data || []);

  // Group transactions by month
  const monthlyRevenue: { [key: string]: number } = {};
  transactions.forEach((tx: any) => {
    if (tx.amount > 0 && tx.date) {
      const txDate = new Date(tx.date);
      const period = txDate.toISOString().substring(0, 7);

      if (txDate >= new Date(fromDate) && txDate < new Date(toDate)) {
        if (!monthlyRevenue[period]) {
          monthlyRevenue[period] = 0;
        }
        monthlyRevenue[period] += tx.amount;
      }
    }
  });

  // Count classes by month
  const monthlyClasses: { [key: string]: number } = {};
  classes.forEach((cls: any) => {
    if (cls.date_time) {
      const classDate = new Date(cls.date_time);
      const period = classDate.toISOString().substring(0, 7);

      if (classDate >= new Date(fromDate) && classDate < new Date(toDate)) {
        if (!monthlyClasses[period]) {
          monthlyClasses[period] = 0;
        }
        monthlyClasses[period]++;
      }
    }
  });

  // Calculate revenue per class for each month
  const historicalData = Object.keys({ ...monthlyRevenue, ...monthlyClasses })
    .map((period) => {
      const revenue = monthlyRevenue[period] || 0;
      const classCount = monthlyClasses[period] || 0;
      return {
        period: `${period}-01`,
        value: classCount > 0 ? revenue / classCount : 0,
      };
    })
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  const currentValue = historicalData.length > 0 ? historicalData[0].value : 0;

  return { currentValue, historicalData };
}
