import type {
  TransactionData,
  BudgetData,
  NormalizedTransaction,
  NormalizedBudget,
} from "@/lib/types/data";

export interface ChartData {
  [key: string]: string | number | undefined;
}

// Income Statement Data Generator (for Waterfall Chart)
export interface WaterfallData {
  name: string;
  value: number;
  isTotal?: boolean;
  color?: string;
  [key: string]: string | number | boolean | undefined;
}

// Helper to normalize amounts to numbers
function normalizeAmounts(
  transactions: TransactionData[]
): NormalizedTransaction[] {
  return transactions.map((tx) => ({
    id: tx.id || "",
    date: tx.date,
    amount:
      typeof tx.amount === "string" ? parseFloat(tx.amount) : tx.amount || 0,
    category: tx.category || "Uncategorized",
    name: tx.name || undefined,
    description: tx.description || undefined,
    reference: tx.reference || undefined,
  }));
}

// MRR Chart Data Generator
export function generateMRRChartData(
  transactions: TransactionData[],
  budget: BudgetData[]
): ChartData[] {
  const normalized = normalizeAmounts(transactions);

  if (normalized.length === 0) {
    return [
      { name: "Plan vs Actual", plan: 0, actual: 0, variance: "N/A" },
      { name: "LTM vs Current", ltm: 0, current: 0, variance: "N/A" },
    ];
  }

  const isRevenue = (category: string): boolean => {
    const revenueCategories = [
      "subscription",
      "consulting",
      "one-time service",
      "service",
      "sales",
      "revenue",
      "wiederk",
    ];
    return revenueCategories.some((cat) =>
      category?.toLowerCase().includes(cat)
    );
  };

  const isRecurringRevenue = (category: string): boolean => {
    const recurringCategories = ["subscription", "monthly", "recurring", "mrr"];
    return recurringCategories.some((cat) =>
      category?.toLowerCase().includes(cat)
    );
  };

  // Get latest month with data
  const latestTransaction = normalized
    .map((t) => new Date(t.date))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const targetMonth = latestTransaction || new Date();
  const monthStart = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth(),
    1
  );
  const monthEnd = new Date(
    targetMonth.getFullYear(),
    targetMonth.getMonth() + 1,
    0,
    23,
    59,
    59
  );

  // Calculate actual MRR from current month transactions
  const currentMonthTransactions = normalized.filter((t) => {
    const date = new Date(t.date);
    return date >= monthStart && date <= monthEnd;
  });

  // If no transactions in current month, use all transactions (same fallback as metrics)
  const transactionsToUse =
    currentMonthTransactions.length > 0 ? currentMonthTransactions : normalized;

  const recurringRevenue = transactionsToUse
    .filter((t) => t.amount > 0 && isRecurringRevenue(t.category))
    .reduce((sum, t) => sum + t.amount, 0);

  const totalMonthlyRevenue = transactionsToUse
    .filter((t) => t.amount > 0 && isRevenue(t.category))
    .reduce((sum, t) => sum + t.amount, 0);

  // If no revenue found with category matching, use ALL positive transactions (same as metrics)
  const allPositiveTransactions = transactionsToUse
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  // Use recurring revenue if available, otherwise fall back to total revenue, then all positive
  const actualMRR =
    recurringRevenue > 0
      ? recurringRevenue
      : totalMonthlyRevenue > 0
        ? totalMonthlyRevenue
        : allPositiveTransactions;

  // Get planned MRR from budget
  const monthKey = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`;

  const monthBudget = budget.filter((b: BudgetData) =>
    (b.month || "").startsWith(monthKey)
  );

  const plannedMRR = monthBudget
    .filter((b: BudgetData) => {
      const cat = (b.category || "").toLowerCase();
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return /revenue|income|sales|mrr/i.test(cat) && value > 0;
    })
    .reduce((sum: number, b: BudgetData) => {
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return sum + value;
    }, 0);

  // Calculate LTM average
  const yearAgo = new Date(targetMonth);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const ltmTransactions = normalized.filter(
    (t) => new Date(t.date) > yearAgo && new Date(t.date) <= monthEnd
  );

  const ltmTotalRevenue = ltmTransactions
    .filter((t) => t.amount > 0 && isRevenue(t.category))
    .reduce((sum, t) => sum + t.amount, 0);

  // If no revenue found with category matching, use ALL positive transactions
  const ltmAllPositive = ltmTransactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const ltmAverage =
    (ltmTotalRevenue > 0 ? ltmTotalRevenue : ltmAllPositive) / 12;

  return [
    {
      name: "Plan vs Actual",
      plan: Math.round(plannedMRR),
      actual: Math.round(actualMRR),
      variance:
        plannedMRR > 0
          ? ((actualMRR / plannedMRR - 1) * 100).toFixed(1) + "%"
          : "N/A",
    },
    {
      name: "LTM vs Current",
      ltm: Math.round(ltmAverage),
      current: Math.round(actualMRR),
      variance:
        ltmAverage > 0
          ? ((actualMRR / ltmAverage - 1) * 100).toFixed(1) + "%"
          : "N/A",
    },
  ];
}

// Burn Rate Chart Data Generator
export function generateBurnRateChartData(
  transactions: TransactionData[]
): ChartData[] {
  const normalized = normalizeAmounts(transactions);
  const monthlyData: ChartData[] = [];

  if (normalized.length === 0) {
    // Return empty data for last 6 months
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthYear = date.toLocaleString("default", {
        month: "short",
        year: "numeric",
      });
      monthlyData.push({
        month: monthYear,
        revenue: 0,
        expenses: 0,
        netBurn: 0,
      });
    }
    return monthlyData;
  }

  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthYear = date.toLocaleString("default", {
      month: "short",
      year: "numeric",
    });
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    const monthTransactions = normalized.filter((t) => {
      const tDate = new Date(t.date);
      return tDate >= monthStart && tDate <= monthEnd;
    });

    // If no transactions in this month, try to use all transactions as fallback (only for current/latest month)
    const transactionsToUse =
      monthTransactions.length > 0 || i !== 0 ? monthTransactions : normalized;

    const revenue = transactionsToUse
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    const expenses = Math.abs(
      transactionsToUse
        .filter((t) => t.amount < 0)
        .reduce((sum, t) => sum + t.amount, 0)
    );

    monthlyData.push({
      month: monthYear,
      revenue: revenue,
      expenses: expenses,
      netBurn: expenses - revenue,
    });
  }

  return monthlyData;
}

// Variance Analysis Data Generator
export function generateVarianceAnalysisData(
  transactions: TransactionData[],
  budget: BudgetData[]
): ChartData[] {
  const normalized = normalizeAmounts(transactions);
  const currentMonth = new Date();
  const monthKey = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}`;

  const monthTransactions = normalized.filter((t) => {
    const date = new Date(t.date);
    return (
      date.getMonth() === currentMonth.getMonth() &&
      date.getFullYear() === currentMonth.getFullYear()
    );
  });

  const actualRevenue = monthTransactions
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const actualExpenses = Math.abs(
    monthTransactions
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0)
  );

  // Get budget data for current month
  const monthBudget = budget.filter((b: BudgetData) =>
    (b.month || "").startsWith(monthKey)
  );

  const budgetRevenue = monthBudget
    .filter((b: BudgetData) => {
      const cat = (b.category || "").toLowerCase();
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return /revenue|income|sales|mrr/i.test(cat) && value > 0;
    })
    .reduce((sum: number, b: BudgetData) => {
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return sum + value;
    }, 0);

  const budgetExpenses = Math.abs(
    monthBudget
      .filter((b: BudgetData) => {
        const cat = (b.category || "").toLowerCase();
        const value =
          typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
        return /expense|cost|opex|fc/i.test(cat) && value < 0;
      })
      .reduce((sum: number, b: BudgetData) => {
        const value =
          typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
        return sum + value;
      }, 0)
  );

  const variances: ChartData[] = [];

  if (budgetRevenue > 0 || actualRevenue > 0) {
    variances.push({
      metric: "Revenue",
      budget: budgetRevenue,
      actual: actualRevenue,
      variance: actualRevenue - budgetRevenue,
      variancePercent:
        budgetRevenue > 0
          ? ((actualRevenue / budgetRevenue - 1) * 100).toFixed(1)
          : "N/A",
    });
  }

  if (budgetExpenses > 0 || actualExpenses > 0) {
    variances.push({
      metric: "Operating Expenses",
      budget: budgetExpenses,
      actual: actualExpenses,
      variance: actualExpenses - budgetExpenses,
      variancePercent:
        budgetExpenses > 0
          ? ((actualExpenses / budgetExpenses - 1) * 100).toFixed(1)
          : "N/A",
    });
  }

  return variances;
}

// YTD Performance Data Generator
export function generateYTDPerformanceData(
  transactions: TransactionData[],
  budget: BudgetData[]
): ChartData[] {
  const normalized = normalizeAmounts(transactions);
  const currentYear = new Date().getFullYear();
  const ytdData: ChartData[] = [];

  if (normalized.length === 0) {
    // Return empty data for YTD if no transactions
    for (let month = 0; month <= new Date().getMonth(); month++) {
      const monthDate = new Date(currentYear, month, 1);
      const monthName = monthDate.toLocaleString("default", { month: "short" });
      const monthKey = `${currentYear}-${String(month + 1).padStart(2, "0")}`;
      ytdData.push({
        month: monthName,
        actual: 0,
        budget: 0,
        cumActual: 0,
        cumBudget: 0,
      });
    }
    return ytdData;
  }

  for (let month = 0; month <= new Date().getMonth(); month++) {
    const monthDate = new Date(currentYear, month, 1);
    const monthName = monthDate.toLocaleString("default", { month: "short" });
    const monthKey = `${currentYear}-${String(month + 1).padStart(2, "0")}`;

    const monthTransactions = normalized.filter((t) => {
      const date = new Date(t.date);
      return date.getMonth() === month && date.getFullYear() === currentYear;
    });

    const revenue = monthTransactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    // Get budget for this month
    const monthBudget = budget.filter((b: BudgetData) =>
      (b.month || "").startsWith(monthKey)
    );

    const plannedRevenue = monthBudget
      .filter((b: BudgetData) => {
        const cat = (b.category || "").toLowerCase();
        const value =
          typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
        return /revenue|income|sales|mrr/i.test(cat) && value > 0;
      })
      .reduce((sum: number, b: BudgetData) => {
        const value =
          typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
        return sum + value;
      }, 0);

    ytdData.push({
      month: monthName,
      actual: revenue,
      budget: plannedRevenue,
      cumActual:
        ytdData.reduce((sum, d) => sum + ((d.actual as number) || 0), 0) +
        revenue,
      cumBudget:
        ytdData.reduce((sum, d) => sum + ((d.budget as number) || 0), 0) +
        plannedRevenue,
    });
  }

  return ytdData;
}

// Income Statement Data Generator (for Waterfall Chart)
export function generateIncomeStatementData(
  transactions: TransactionData[]
): WaterfallData[] {
  const normalized = normalizeAmounts(transactions);

  // Get current month transactions
  const currentMonth = new Date();
  const monthStart = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  );
  const monthEnd = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
    23,
    59,
    59
  );

  const monthTransactions = normalized.filter((t) => {
    const date = new Date(t.date);
    return date >= monthStart && date <= monthEnd;
  });

  // Group by category
  const categories: Record<string, number> = {};
  monthTransactions.forEach((t) => {
    const cat = t.category || "Uncategorized";
    categories[cat] = (categories[cat] || 0) + t.amount;
  });

  // Calculate revenue and expenses
  const totalRevenue = Object.entries(categories)
    .filter(([, amount]) => amount > 0)
    .reduce((sum, [, amount]) => sum + amount, 0);

  const totalExpenses = Math.abs(
    Object.entries(categories)
      .filter(([, amount]) => amount < 0)
      .reduce((sum, [, amount]) => sum + amount, 0)
  );

  // Build waterfall data
  const waterfallData: WaterfallData[] = [];

  // Start with revenue
  if (totalRevenue > 0) {
    waterfallData.push({
      name: "Revenue",
      value: totalRevenue,
      color: "#10b981",
    });
  }

  // Add each expense category
  Object.entries(categories).forEach(([category, amount]) => {
    if (amount < 0) {
      waterfallData.push({
        name: category,
        value: amount,
        color: "#ef4444",
      });
    }
  });

  // Add final net income
  const netIncome = totalRevenue - totalExpenses;
  waterfallData.push({
    name: "Net Income",
    value: netIncome,
    isTotal: true,
    color: netIncome >= 0 ? "#3b82f6" : "#dc2626",
  });

  return waterfallData;
}
