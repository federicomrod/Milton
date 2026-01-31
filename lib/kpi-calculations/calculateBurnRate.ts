import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateBurnRate(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  console.log(`[calculateBurnRate] Starting calculation for user ${userId}`);

  // Get company ID
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    console.log(`[calculateBurnRate] Company not found`);
    throw new Error("Company not found");
  }

  console.log(`[calculateBurnRate] Found company ${company.id}`);

  // Get transactions data - try both 'transactions' and 'transaction'
  // Debug: Check what model_table_names exist for this company
  const { data: allTables } = await supabase
    .from("model_data")
    .select("model_table_name")
    .eq("company_id", company.id);

  console.log(
    `[calculateBurnRate] Available model_table_names for company ${company.id}:`,
    allTables?.map((t) => t.model_table_name)
  );

  console.log(
    `[calculateBurnRate] Querying for company_id: ${company.id}, model_table_name: 'transactions'`
  );
  let { data: transactionsData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "transactions");

  // If no data found, try 'transaction' (singular)
  if (!transactionsData || transactionsData.length === 0) {
    console.log(`[calculateBurnRate] Trying model_table_name: 'transaction'`);
    const result = await supabase
      .from("model_data")
      .select("data")
      .eq("company_id", company.id)
      .eq("model_table_name", "transaction");
    transactionsData = result.data;
    error = result.error;
  }

  console.log(`[calculateBurnRate] Query result:`, {
    error,
    dataLength: transactionsData?.length,
    firstRow: transactionsData?.[0],
  });

  if (error || !(transactionsData as any)?.length) {
    console.log(
      `[calculateBurnRate] No transactions data found, error:`,
      error
    );
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data - each row.data is already the transaction object
  const transactions = (transactionsData as any)
    .map((row: any) => row.data)
    .filter(Boolean);
  console.log(`[calculateBurnRate] Found ${transactions.length} transactions`);
  console.log(`[calculateBurnRate] Sample transaction:`, transactions[0]);

  // Group by month and calculate net cash flow (outflows - inflows)
  const monthlyStats: { [key: string]: { inflows: number; outflows: number } } =
    {};

  transactions.forEach((tx: any) => {
    if (tx.amount && tx.date && tx.type) {
      const txDate = new Date(tx.date);
      const period = txDate.toISOString().substring(0, 7);

      if (txDate >= new Date(fromDate) && txDate < new Date(toDate)) {
        if (!monthlyStats[period]) {
          monthlyStats[period] = { inflows: 0, outflows: 0 };
        }

        const amount = parseFloat(tx.amount) || 0;
        if (tx.type === "inflow") {
          monthlyStats[period].inflows += amount;
        } else if (tx.type === "outflow") {
          monthlyStats[period].outflows += amount;
        }
      }
    }
  });

  const historicalData = Object.entries(monthlyStats)
    .map(([period, stats]) => ({
      period: `${period}-01`,
      value: stats.outflows - stats.inflows, // Net outflow (burn)
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  // Calculate average burn rate across all months
  const totalBurn = historicalData.reduce((sum, item) => sum + item.value, 0);
  const averageBurn =
    historicalData.length > 0 ? totalBurn / historicalData.length : 0;
  console.log(
    `[calculateBurnRate] Returning currentValue: ${averageBurn}, historicalData length: ${historicalData.length}`
  );

  return { currentValue: averageBurn, historicalData };
}
