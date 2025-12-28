// lib/report-data-service.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type {
  TransactionData,
  BudgetData,
  CrmDealData,
} from "@/lib/types/data";

export interface ReportPeriod {
  start: string;
  end: string;
}

export interface KPIMetrics {
  revenue: number;
  expenses: number;
  netIncome: number;
  burnRate: number;
  cashRunway: number;
  pipelineValue: number;
  openDeals: number;
}

export interface BudgetVariance {
  label: string;
  actual: number;
  planned: number;
  variance: number;
  variancePct: number;
}

export interface ReportData {
  kpis: KPIMetrics;
  budgetVariance: BudgetVariance[];
  transactions: TransactionData[];
  crmDeals: CrmDealData[];
  budgets: BudgetData[];
  businessType: string | null;
  selectedKpiIds: string[];
}

/**
 * Fetch comprehensive report data from Supabase for the authenticated user
 * and compute summarized metrics used in reports.
 * Server-safe and works in both Node and browser contexts.
 */
export async function getReportData(
  supabase: SupabaseClient,
  userId: string,
  reportPeriod?: ReportPeriod
): Promise<ReportData> {
  // Step 1: Fetch transactions
  let txQuery = supabase
    .from("transactions")
    .select("id, date, amount, category, name, description")
    .eq("user_id", userId)
    .order("date", { ascending: false });

  if (reportPeriod) {
    txQuery = txQuery
      .gte("date", reportPeriod.start)
      .lte("date", reportPeriod.end);
  }

  const { data: transactions, error: txError } = await txQuery;
  if (txError) {
    throw new Error(`Transactions fetch failed: ${txError.message}`);
  }

  console.log("[getReportData] Transactions fetched:", {
    count: transactions?.length || 0,
    period: reportPeriod,
    sample: transactions?.slice(0, 2),
  });

  // Step 2: Fetch CRM deals
  let crmQuery = supabase
    .from("crm_deals")
    .select("id, amount, phase, closing_date, deal_name, client_name")
    .eq("user_id", userId)
    .order("amount", { ascending: false });

  if (reportPeriod) {
    crmQuery = crmQuery
      .gte("closing_date", reportPeriod.start)
      .lte("closing_date", reportPeriod.end);
  }

  const { data: crmDeals, error: crmError } = await crmQuery;
  if (crmError) {
    throw new Error(`CRM deals fetch failed: ${crmError.message}`);
  }

  console.log("[getReportData] CRM deals fetched:", {
    count: crmDeals?.length || 0,
    period: reportPeriod,
    sample: crmDeals?.slice(0, 2),
  });

  // Step 3: Fetch budget data
  let budgetQuery = supabase
    .from("budgets")
    .select("month, category, value")
    .eq("user_id", userId)
    .order("month", { ascending: false });

  if (reportPeriod) {
    budgetQuery = budgetQuery
      .gte("month", reportPeriod.start)
      .lte("month", reportPeriod.end);
  }

  const { data: budgets, error: budgetError } = await budgetQuery;
  if (budgetError) {
    throw new Error(`Budgets fetch failed: ${budgetError.message}`);
  }

  console.log("[getReportData] Budgets fetched:", {
    count: budgets?.length || 0,
    period: reportPeriod,
    sample: budgets?.slice(0, 2),
  });

  // --- Derive metrics ---
  // Ensure amounts are numbers (Supabase NUMERIC can return as string)
  const transactionsWithNumericAmounts =
    transactions?.map((t) => ({
      ...t,
      amount:
        typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0,
    })) || [];

  console.log("[getReportData] Transactions with numeric amounts:", {
    count: transactionsWithNumericAmounts.length,
    sampleAmounts: transactionsWithNumericAmounts.slice(0, 5).map((t) => ({
      amount: t.amount,
      type: typeof t.amount,
      date: t.date,
    })),
  });

  const totalRevenue = transactionsWithNumericAmounts
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactionsWithNumericAmounts
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  console.log("[getReportData] Calculated metrics:", {
    totalRevenue,
    totalExpenses,
    revenueTransactions: transactionsWithNumericAmounts.filter(
      (t) => t.amount > 0
    ).length,
    expenseTransactions: transactionsWithNumericAmounts.filter(
      (t) => t.amount < 0
    ).length,
  });

  const monthsDuration = reportPeriod
    ? getMonthsDiff(reportPeriod.start, reportPeriod.end)
    : 1;

  const burnRate = totalExpenses / monthsDuration;
  const netIncome = totalRevenue - totalExpenses;

  // Calculate net cash position (total of all transactions including negatives)
  // Use transactionsWithNumericAmounts instead of raw transactions
  const netCash = transactionsWithNumericAmounts.reduce(
    (sum, t) => sum + t.amount,
    0
  );
  const cashRunway = burnRate > 0 ? Math.round(netCash / burnRate) : 0;

  console.log("[getReportData] Cash metrics:", {
    netCash,
    burnRate,
    cashRunway,
    monthsDuration,
  });

  // --- CRM metrics ---
  // Ensure amounts are numbers for CRM deals too
  const crmDealsWithNumericAmounts = (crmDeals || []).map((d) => ({
    ...d,
    amount: typeof d.amount === "string" ? parseFloat(d.amount) : d.amount || 0,
  }));

  console.log("[getReportData] CRM deals with numeric amounts:", {
    count: crmDealsWithNumericAmounts.length,
    sampleAmounts: crmDealsWithNumericAmounts.slice(0, 5).map((d) => ({
      amount: d.amount,
      type: typeof d.amount,
      phase: d.phase,
    })),
  });

  const pipelineValue = crmDealsWithNumericAmounts.reduce(
    (sum, d) => sum + d.amount,
    0
  );
  const openDeals = crmDealsWithNumericAmounts.filter(
    (d) =>
      d.phase !== "Deal" &&
      d.phase !== "No Deal" &&
      d.phase !== "Closed Won" &&
      d.phase !== "Closed Lost"
  ).length;

  console.log("[getReportData] CRM metrics:", {
    pipelineValue,
    openDeals,
    totalDeals: crmDealsWithNumericAmounts.length,
  });

  // --- Budget variance ---
  const budgetSummary = computeBudgetVariance(
    transactions || [],
    budgets || []
  );

  // Step 4: Fetch user preferences from business_models
  // Get company for user
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  let modelRow = null;
  if (company) {
    const { data } = await supabase
      .from("business_models")
      .select("business_type, selected_kpi_ids")
      .eq("company_id", company.id)
      .single();
    modelRow = data;
  }

  const finalKPIs = {
    revenue: totalRevenue,
    expenses: totalExpenses,
    netIncome,
    burnRate,
    cashRunway,
    pipelineValue,
    openDeals,
  };

  console.log("[getReportData] Final KPIs:", finalKPIs);
  console.log("[getReportData] Budget variance:", budgetSummary);

  return {
    kpis: finalKPIs,
    budgetVariance: budgetSummary,
    transactions: transactions || [],
    crmDeals: crmDeals || [],
    budgets: budgets || [],
    businessType: (modelRow?.business_type ?? null) as string | null,
    selectedKpiIds: (modelRow?.selected_kpi_ids ?? []) as string[],
  };
}

/**
 * Compare actual vs planned revenue and expenses from transactions and budgets
 */
function computeBudgetVariance(
  transactions: any[],
  budgets: any[]
): BudgetVariance[] {
  if (!budgets?.length || !transactions?.length) {
    return [
      {
        label: "Revenue",
        actual: 0,
        planned: 0,
        variance: 0,
        variancePct: 0,
      },
      {
        label: "Expenses",
        actual: 0,
        planned: 0,
        variance: 0,
        variancePct: 0,
      },
    ];
  }

  const actualRevenue = transactions
    .filter((t) => t.amount > 0)
    .reduce((s, t) => s + t.amount, 0);

  const actualExpenses = transactions
    .filter((t) => t.amount < 0)
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  // Sum budgeted amounts (assuming positive for revenue categories)
  const plannedRevenue = budgets
    .filter(
      (b) => b.value > 0 && /revenue|income|sales|mrr/i.test(b.category || "")
    )
    .reduce((s, b) => s + Number(b.value || 0), 0);

  const plannedExpenses = budgets
    .filter((b) =>
      /expense|opex|cost|salary|marketing|rent/i.test(b.category || "")
    )
    .reduce((s, b) => s + Number(b.value || 0), 0);

  return [
    {
      label: "Revenue",
      actual: actualRevenue,
      planned: plannedRevenue,
      variance: actualRevenue - plannedRevenue,
      variancePct: plannedRevenue
        ? ((actualRevenue - plannedRevenue) / plannedRevenue) * 100
        : 0,
    },
    {
      label: "Expenses",
      actual: actualExpenses,
      planned: plannedExpenses,
      variance: actualExpenses - plannedExpenses,
      variancePct: plannedExpenses
        ? ((actualExpenses - plannedExpenses) / plannedExpenses) * 100
        : 0,
    },
  ];
}

/**
 * Calculate the number of months between two dates
 */
function getMonthsDiff(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  const months =
    (e.getFullYear() - s.getFullYear()) * 12 +
    (e.getMonth() - s.getMonth()) +
    1;
  return Math.max(1, months);
}

/**
 * Retrieves user's KPI preferences (selected KPI IDs and business type)
 * from the business_models table
 */
export async function getUserKpiPreferences(
  supabase: SupabaseClient,
  userId: string
) {
  try {
    // Get company for user
    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();

    if (!company) {
      return null;
    }

    const { data, error } = await supabase
      .from("business_models")
      .select("selected_kpi_ids, business_type")
      .eq("company_id", company.id)
      .single();

    if (error) {
      console.warn("[getUserKpiPreferences] Query error:", {
        code: error.code,
        message: error.message,
      });
      return {
        selectedKpiIds: [],
        businessType: null,
      };
    }

    return {
      selectedKpiIds: (data?.selected_kpi_ids ?? []) as string[],
      businessType: data?.business_type as string | null,
    };
  } catch (err) {
    console.error("[getUserKpiPreferences] Unexpected error:", err);
    return {
      selectedKpiIds: [],
      businessType: null,
    };
  }
}
