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
  const normalized = normalizeAmounts(transactions || []);

  // If no transactions, return empty
  if (normalized.length === 0) {
    console.log("[generateVarianceAnalysisData] No transactions provided");
    return [];
  }

  // Use the latest month from the transactions instead of always using current month
  // This allows the chart to work with any date range
  const transactionDates = normalized
    .map((t) => new Date(t.date))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  if (transactionDates.length === 0) {
    console.log("[generateVarianceAnalysisData] No valid transaction dates");
    return [];
  }

  // Use the most recent month from the transactions
  const latestTransactionDate = transactionDates[0];
  const targetMonth = new Date(
    latestTransactionDate.getFullYear(),
    latestTransactionDate.getMonth(),
    1
  );
  const monthKey = `${targetMonth.getFullYear()}-${String(targetMonth.getMonth() + 1).padStart(2, "0")}`;

  const monthTransactions = normalized.filter((t) => {
    const date = new Date(t.date);
    return (
      date.getMonth() === targetMonth.getMonth() &&
      date.getFullYear() === targetMonth.getFullYear()
    );
  });

  // If no transactions in the target month, use all transactions as fallback
  const transactionsToUse =
    monthTransactions.length > 0 ? monthTransactions : normalized;

  const actualRevenue = transactionsToUse
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const actualExpenses = Math.abs(
    transactionsToUse
      .filter((t) => t.amount < 0)
      .reduce((sum, t) => sum + t.amount, 0)
  );

  // Get budget data for current month
  const monthBudget = (budget || []).filter((b: BudgetData) =>
    (b.month || "").startsWith(monthKey)
  );

  const budgetRevenue = monthBudget
    .filter((b: BudgetData) => {
      const cat = (b.category || "").toLowerCase();
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      // Match revenue categories (positive values)
      return /revenue|income|sales|mrr/i.test(cat) && value > 0;
    })
    .reduce((sum: number, b: BudgetData) => {
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return sum + value;
    }, 0);

  const budgetExpenses = monthBudget
    .filter((b: BudgetData) => {
      const cat = (b.category || "").toLowerCase();
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      // Match expense categories (can be positive or negative, but typically positive in budgets)
      return (
        /expense|cost|opex|fc|variable|fixed|salary|marketing|rent/i.test(
          cat
        ) && value > 0
      );
    })
    .reduce((sum: number, b: BudgetData) => {
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return sum + Math.abs(value);
    }, 0);

  const variances: ChartData[] = [];

  // Always show revenue if we have actual data (even without budget)
  if (actualRevenue > 0) {
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

  // Always show expenses if we have actual data (even without budget)
  if (actualExpenses > 0) {
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

  // If we have budget but no actuals, still show the budget
  if (actualRevenue === 0 && actualExpenses === 0) {
    if (budgetRevenue > 0) {
      variances.push({
        metric: "Revenue",
        budget: budgetRevenue,
        actual: 0,
        variance: -budgetRevenue,
        variancePercent: "N/A",
      });
    }
    if (budgetExpenses > 0) {
      variances.push({
        metric: "Operating Expenses",
        budget: budgetExpenses,
        actual: 0,
        variance: -budgetExpenses,
        variancePercent: "N/A",
      });
    }
  }

  // If we have budgets but no matching categories, try to use all budgets
  // This handles cases where category names don't match our patterns
  if (variances.length === 0 && monthBudget.length > 0) {
    // Sum all positive budget values (could be revenue or expenses)
    const totalBudget = monthBudget.reduce((sum: number, b: BudgetData) => {
      const value =
        typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
      return sum + Math.abs(value);
    }, 0);

    // If we have any budget data, show it even if categories don't match
    if (totalBudget > 0) {
      // Try to split: if we have actual revenue, assume budget is for revenue
      // Otherwise, assume it's expenses
      if (actualRevenue > 0) {
        variances.push({
          metric: "Revenue",
          budget: totalBudget,
          actual: actualRevenue,
          variance: actualRevenue - totalBudget,
          variancePercent:
            totalBudget > 0
              ? ((actualRevenue / totalBudget - 1) * 100).toFixed(1)
              : "N/A",
        });
      }

      if (actualExpenses > 0 || actualRevenue === 0) {
        variances.push({
          metric: "Operating Expenses",
          budget: totalBudget,
          actual: actualExpenses,
          variance: actualExpenses - totalBudget,
          variancePercent:
            totalBudget > 0
              ? ((actualExpenses / totalBudget - 1) * 100).toFixed(1)
              : "N/A",
        });
      }
    }
  }

  // If still no data but we have budgets for other months, show the latest month with budget data
  if (variances.length === 0 && (budget || []).length > 0) {
    // Find the most recent month with budget data
    const allMonths = [
      ...new Set(
        (budget || []).map((b: BudgetData) => b.month).filter(Boolean)
      ),
    ]
      .sort()
      .reverse();
    if (allMonths.length > 0) {
      const latestMonth = allMonths[0];
      const latestMonthBudget = (budget || []).filter(
        (b: BudgetData) => b.month === latestMonth
      );
      const totalLatestBudget = latestMonthBudget.reduce(
        (sum: number, b: BudgetData) => {
          const value =
            typeof b.value === "string" ? parseFloat(b.value) : b.value || 0;
          return sum + Math.abs(value);
        },
        0
      );

      if (totalLatestBudget > 0) {
        variances.push({
          metric: `Budget (${latestMonth})`,
          budget: totalLatestBudget,
          actual: 0,
          variance: -totalLatestBudget,
          variancePercent: "N/A",
        });
      }
    }
  }

  console.log("[generateVarianceAnalysisData] Result:", {
    monthKey,
    monthBudgetCount: monthBudget.length,
    budgetRevenue,
    budgetExpenses,
    actualRevenue,
    actualExpenses,
    variancesCount: variances.length,
    variances,
  });

  return variances;
}

// YTD Performance Data Generator
export function generateYTDPerformanceData(
  transactions: TransactionData[],
  budget: BudgetData[]
): ChartData[] {
  const normalized = normalizeAmounts(transactions);
  const ytdData: ChartData[] = [];

  if (normalized.length === 0) {
    // Return empty data for YTD if no transactions
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth();
    for (let month = 0; month <= currentMonth; month++) {
      const monthDate = new Date(currentYear, month, 1);
      const monthName = monthDate.toLocaleString("default", { month: "short" });
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

  // Find the year from the transactions (use the most recent year)
  const transactionYears = normalized
    .map((t) => {
      const date = new Date(t.date);
      return isNaN(date.getTime()) ? null : date.getFullYear();
    })
    .filter((year): year is number => year !== null)
    .sort((a, b) => b - a);

  if (transactionYears.length === 0) {
    return ytdData;
  }

  const targetYear = transactionYears[0]; // Use most recent year
  const currentDate = new Date();
  const isCurrentYear = targetYear === currentDate.getFullYear();

  // Determine how many months to show
  // If it's the current year, show up to current month
  // Otherwise, show all 12 months
  const maxMonth = isCurrentYear ? currentDate.getMonth() : 11;

  for (let month = 0; month <= maxMonth; month++) {
    const monthDate = new Date(targetYear, month, 1);
    const monthName = monthDate.toLocaleString("default", { month: "short" });
    const monthKey = `${targetYear}-${String(month + 1).padStart(2, "0")}`;

    const monthTransactions = normalized.filter((t) => {
      const date = new Date(t.date);
      return date.getMonth() === month && date.getFullYear() === targetYear;
    });

    const revenue = monthTransactions
      .filter((t) => t.amount > 0)
      .reduce((sum, t) => sum + t.amount, 0);

    // Get budget for this month
    const monthBudget = (budget || []).filter((b: BudgetData) =>
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

  console.log("[generateYTDPerformanceData] Result:", {
    targetYear,
    maxMonth,
    transactionsCount: normalized.length,
    ytdDataCount: ytdData.length,
    totalActual: ytdData.reduce(
      (sum, d) => sum + ((d.actual as number) || 0),
      0
    ),
    totalBudget: ytdData.reduce(
      (sum, d) => sum + ((d.budget as number) || 0),
      0
    ),
  });

  return ytdData;
}

// Income Statement Data Generator (for Waterfall Chart)
export function generateIncomeStatementData(
  transactions: TransactionData[]
): WaterfallData[] {
  const normalized = normalizeAmounts(transactions || []);

  if (normalized.length === 0) {
    return [];
  }

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

  let monthTransactions = normalized.filter((t) => {
    const date = new Date(t.date);
    return date >= monthStart && date <= monthEnd;
  });

  // If no transactions in current month, use all transactions (fallback)
  if (monthTransactions.length === 0) {
    monthTransactions = normalized;
    console.log(
      "[generateIncomeStatementData] No current month transactions, using all transactions"
    );
  }

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

  console.log("[generateIncomeStatementData] Result:", {
    monthTransactionsCount: monthTransactions.length,
    totalTransactionsCount: normalized.length,
    totalRevenue,
    totalExpenses,
    netIncome,
    waterfallDataCount: waterfallData.length,
    categories: Object.keys(categories),
  });

  return waterfallData;
}
