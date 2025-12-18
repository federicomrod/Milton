// lib/report-data-service.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { BusinessTypeId } from "@/lib/business-types";
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
  businessType: BusinessTypeId | null;
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
    .select("id, date, amount, category, name, description, reference")
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

  // Step 2: Fetch CRM deals
  let crmQuery = supabase
    .from("crm_deals")
    .select(
      "id, amount, phase, closing_date, deal_name, client_name, created_date, product, stage, company, owner, close_date"
    )
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

  // --- Derive metrics ---
  // Ensure amounts are numbers (Supabase NUMERIC can return as string)
  const transactionsWithNumericAmounts =
    transactions?.map((t) => ({
      ...t,
      amount:
        typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0,
    })) || [];

  const totalRevenue = transactionsWithNumericAmounts
    .filter((t) => t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpenses = transactionsWithNumericAmounts
    .filter((t) => t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const monthsDuration = reportPeriod
    ? getMonthsDiff(reportPeriod.start, reportPeriod.end)
    : 1;

  const burnRate = totalExpenses / monthsDuration;
  const netIncome = totalRevenue - totalExpenses;

  // Calculate net cash position (total of all transactions including negatives)
  const netCash = transactions?.reduce((sum, t) => sum + t.amount, 0) || 0;
  const cashRunway = burnRate > 0 ? Math.round(netCash / burnRate) : 0;

  // --- CRM metrics ---
  const pipelineValue =
    crmDeals?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0;
  const openDeals =
    crmDeals?.filter(
      (d) =>
        d.phase !== "Deal" &&
        d.phase !== "No Deal" &&
        d.phase !== "Closed Won" &&
        d.phase !== "Closed Lost"
    ).length || 0;

  // --- Budget variance ---
  const budgetSummary = computeBudgetVariance(
    transactions || [],
    budgets || []
  );

  // Step 4: Fetch user preferences from business_models
  const { data: modelRow } = await supabase
    .from("business_models")
    .select("business_type, selected_kpi_ids")
    .eq("user_id", userId)
    .single();

  return {
    kpis: {
      revenue: totalRevenue,
      expenses: totalExpenses,
      netIncome,
      burnRate,
      cashRunway,
      pipelineValue,
      openDeals,
    },
    budgetVariance: budgetSummary,
    transactions: transactions || [],
    crmDeals: crmDeals || [],
    budgets: budgets || [],
    businessType: (modelRow?.business_type ?? null) as BusinessTypeId | null,
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
 * Fetches monthly KPI snapshots (Phase 3 placeholder)
 * from Supabase RPC `get_user_kpis`.
 * Returns an array of objects [{ month, revenue, expenses, net_income }]
 */
export async function getKpiSnapshots(userId: string) {
  try {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_user_kpis", {
      uid: userId,
    });
    if (error) {
      console.error("[getKpiSnapshots] Supabase RPC error:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("[getKpiSnapshots] Unexpected error:", err);
    return [];
  }
}

/**
 * Retrieves all KPI snapshots for the current user.
 * These snapshots are created after datasets are linked and processed.
 */
export async function getUserKpiSnapshots(
  supabase: SupabaseClient,
  userId: string
) {
  try {
    // Try RPC first
    const { data, error } = await supabase.rpc("get_user_kpi_snapshots", {
      uid: userId,
    });
    if (!error) {
      return data || [];
    }

    // Log structured error details
    console.warn("[getUserKpiSnapshots] RPC error:", {
      code: error.code,
      message: error.message,
      details: error.details,
    });

    // Fallback to direct table query
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("kpi_snapshots_data")
      .select("*")
      .eq("user_id", userId)
      .order("period", { ascending: false });

    if (fallbackError) {
      console.warn("[getUserKpiSnapshots] Fallback query error:", {
        code: fallbackError.code,
        message: fallbackError.message,
        details: fallbackError.details,
      });
      return [];
    }

    return fallbackData || [];
  } catch (err) {
    console.error("[getUserKpiSnapshots] Unexpected error:", err);
    return [];
  }
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
    const { data, error } = await supabase
      .from("business_models")
      .select("selected_kpi_ids, business_type")
      .eq("user_id", userId)
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
