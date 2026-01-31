import { SupabaseClient } from "@supabase/supabase-js";

export async function calculateRunway(
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

  // Get transactions data
  console.log(
    `[calculateRunway] Querying for company_id: ${company.id}, model_table_name: 'transactions'`
  );
  const { data: transactionsData, error } = await supabase
    .from("model_data")
    .select("data")
    .eq("company_id", company.id)
    .eq("model_table_name", "transactions");

  console.log(`[calculateRunway] Query result:`, {
    error,
    dataLength: transactionsData?.length,
    firstRow: transactionsData?.[0],
  });

  if (error || !(transactionsData as any)?.length) {
    console.log(`[calculateRunway] No transactions data found, error:`, error);
    return { currentValue: 0, historicalData: [] };
  }

  // Flatten the data - each row.data is already the transaction object
  const transactions = (transactionsData as any)
    .map((row: any) => row.data)
    .filter(Boolean);
  console.log(`[calculateRunway] Found ${transactions.length} transactions`);
  console.log(`[calculateRunway] Sample transaction:`, transactions[0]);

  // Calculate cash balance over time
  // First, sort transactions by date
  const sortedTransactions = transactions
    .filter((tx: any) => tx.amount && tx.date && tx.type)
    .sort(
      (a: any, b: any) =>
        new Date(a.date).getTime() - new Date(b.date).getTime()
    );

  // Calculate running balance
  let balance = 0;
  const balanceHistory: { date: Date; balance: number }[] = [];

  sortedTransactions.forEach((tx: any) => {
    const amount = parseFloat(tx.amount) || 0;
    if (tx.type === "inflow") {
      balance += amount;
    } else if (tx.type === "outflow") {
      balance -= amount;
    }
    balanceHistory.push({
      date: new Date(tx.date),
      balance: balance,
    });
  });

  // Calculate monthly burn rate (average outflow over last 3 months)
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

  // Get last 3 months of burn data
  const burnRates = Object.values(monthlyStats)
    .slice(-3)
    .map((stats) => stats.outflows - stats.inflows)
    .filter((burn) => burn > 0); // Only positive burn (net outflows)

  const averageBurn =
    burnRates.length > 0
      ? burnRates.reduce((sum, burn) => sum + burn, 0) / burnRates.length
      : 0;

  // Get current balance (latest balance from history)
  const currentBalance =
    balanceHistory.length > 0
      ? balanceHistory[balanceHistory.length - 1].balance
      : 0;

  // Calculate runway in months
  const runway = averageBurn > 0 ? currentBalance / averageBurn : 0;

  // For historical data, we could show runway over time
  // But for simplicity, we'll show the same value for each month
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
    value: runway,
  }));

  return { currentValue: runway, historicalData };
}
