// lib/cash-flow-data-generators.ts
import type { TransactionData } from "@/lib/types/data";

export interface Transaction {
  id: string;
  date: string;
  name: string;
  amount: number;
  reference: string;
  category: string;
}

export interface MonthlyFlowData {
  month: string;
  inflow: number;
  outflow: number;
  netFlow: number;
  balance: number;
  transactions: Transaction[];
}

export interface CategoryBreakdown {
  category: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashFlowMetrics {
  currentBalance: number;
  monthlyFlow: MonthlyFlowData[];
  categoryBreakdown: CategoryBreakdown[];
  runwayMonths: number;
  burnRate: number;
}

export function normalizeTransactions(data: TransactionData[]): Transaction[] {
  return (data || []).map((tx: TransactionData) => ({
    id: tx.id,
    date: tx.date,
    name: tx.name || tx.description || "Unknown",
    amount:
      typeof tx.amount === "string" ? parseFloat(tx.amount) : tx.amount || 0,
    reference: tx.reference || "",
    category: tx.category || "Uncategorized",
  }));
}

export function calculateCashFlowMetrics(
  txData: Transaction[]
): CashFlowMetrics {
  // Sort transactions by date
  const sortedTx = [...txData].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calculate running balance
  let runningBalance = 0;
  const monthlyData: Record<string, MonthlyFlowData> = {};

  sortedTx.forEach((tx) => {
    runningBalance += tx.amount;
    const date = new Date(tx.date);
    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: date.toLocaleString("default", {
          month: "short",
          year: "numeric",
        }),
        inflow: 0,
        outflow: 0,
        netFlow: 0,
        balance: 0,
        transactions: [],
      };
    }

    if (tx.amount > 0) {
      monthlyData[monthKey].inflow += tx.amount;
    } else {
      monthlyData[monthKey].outflow += Math.abs(tx.amount);
    }
    monthlyData[monthKey].netFlow =
      monthlyData[monthKey].inflow - monthlyData[monthKey].outflow;
    monthlyData[monthKey].balance = runningBalance;
    monthlyData[monthKey].transactions.push(tx);
  });

  // Convert to array and sort
  const monthlyFlow = Object.values(monthlyData).sort((a, b) => {
    const dateA = new Date(a.month);
    const dateB = new Date(b.month);
    return dateA.getTime() - dateB.getTime();
  });

  // Category breakdown
  const categoryTotals: {
    [key: string]: { inflow: number; outflow: number };
  } = {};
  txData.forEach((tx) => {
    if (!categoryTotals[tx.category]) {
      categoryTotals[tx.category] = { inflow: 0, outflow: 0 };
    }
    if (tx.amount > 0) {
      categoryTotals[tx.category].inflow += tx.amount;
    } else {
      categoryTotals[tx.category].outflow += Math.abs(tx.amount);
    }
  });

  const categoryBreakdown: CategoryBreakdown[] = Object.entries(categoryTotals)
    .map(([category, values]) => ({
      category,
      inflow: values.inflow,
      outflow: values.outflow,
      net: values.inflow - values.outflow,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  // Calculate burn rate (last 3 months average)
  const last3Months = monthlyFlow.slice(-3);
  const avgBurnRate =
    last3Months.length > 0
      ? last3Months.reduce(
          (sum: number, m: MonthlyFlowData) => sum + (m.outflow - m.inflow),
          0
        ) / last3Months.length
      : 0;

  // Calculate runway
  const currentBalance = runningBalance;
  const runwayMonths =
    avgBurnRate > 0 ? Math.round(currentBalance / avgBurnRate) : 999;

  return {
    currentBalance,
    monthlyFlow,
    categoryBreakdown,
    runwayMonths,
    burnRate: avgBurnRate,
  };
}
