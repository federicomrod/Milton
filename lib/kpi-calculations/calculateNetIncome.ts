import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateNetIncome(
  supabase: SupabaseClient,
  userId: string,
  fromDate: string,
  toDate: string
) {
  console.log(`[calculateNetIncome] Starting calculation for user ${userId}`);

  // Get company ID
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  if (!company) {
    console.log(`[calculateNetIncome] Company not found`);
    throw new Error("Company not found");
  }

  console.log(`[calculateNetIncome] Found company ${company.id}`);

  // Get transactions data
  console.log(
    `[calculateNetIncome] Querying for company_id: ${company.id}, model_table_name: 'transactions'`
  );
  const { data: transactionsData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "transactions");

  console.log(`[calculateNetIncome] Query result:`, {
    error,
    dataLength: transactionsData?.length,
    firstRow: transactionsData?.[0],
  });

  if (error || !(transactionsData as any)?.length) {
    console.log(
      `[calculateNetIncome] No transactions data found, error:`,
      error
    );
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data - each row.data is already the transaction object
  const transactions = (transactionsData as any)
    .map((row: any) => row.data)
    .filter(Boolean);
  console.log(`[calculateNetIncome] Found ${transactions.length} transactions`);
  console.log(`[calculateNetIncome] Sample transaction:`, transactions[0]);

  // Calculate total inflows and outflows in the period
  let totalInflows = 0;
  let totalOutflows = 0;

  transactions.forEach((tx: any) => {
    if (tx.amount && tx.date && tx.type) {
      const txDate = new Date(tx.date);
      if (txDate >= new Date(fromDate) && txDate < new Date(toDate)) {
        const amount = parseFloat(tx.amount) || 0;
        if (tx.type === "inflow") {
          totalInflows += amount;
        } else if (tx.type === "outflow") {
          totalOutflows += amount;
        }
      }
    }
  });

  const netIncome = totalInflows - totalOutflows;
  console.log(
    `[calculateNetIncome] Total inflows: ${totalInflows}, outflows: ${totalOutflows}, net: ${netIncome}`
  );

  // For historical data, we could show monthly net income
  // Group by month
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
      value: stats.inflows - stats.outflows,
    }))
    .sort(
      (a, b) => new Date(a.period).getTime() - new Date(b.period).getTime()
    );

  return { currentValue: netIncome, historicalData };
}
