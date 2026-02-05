// lib/report-data-service.ts
import { SupabaseClient } from "@supabase/supabase-js";
import { normalizeStage } from "@/lib/utils/pipeline-utils";
import { getDataTablesByIds } from "@/lib/data-table-service";
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
  hasModelData: boolean;
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
  const { data: company } = await supabase
    .from("companies")
    .select("id")
    .eq("created_by", userId)
    .single();

  // Initialize empty arrays (legacy tables removed, only using model_data)
  const transactions: TransactionData[] = [];
  const crmDeals: CrmDealData[] = [];
  const budgets: BudgetData[] = [];

  // Fetch model_data (company-scoped; no user_id) with pagination
  let modelData: { model_table_name: string; data: unknown }[] = [];
  let modelError: { message: string } | null = null;
  if (company?.id) {
    // Fetch with pagination to get all records (Supabase default limit is 1000)
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const result = await supabase
        .from("model_data")
        .select("model_table_id, data")
        .eq("company_id", company.id)
        .range(from, from + pageSize - 1)
        .order("id", { ascending: true });

      if (result.error) {
        modelError = result.error;
        hasMore = false;
        break;
      }

      if (result.data && result.data.length > 0) {
        // Get table IDs and convert to names
        const tableIds = [
          ...new Set(result.data.map((row) => row.model_table_id)),
        ];
        const tableDefinitions = await getDataTablesByIds(tableIds);
        const idToNameMap: Record<string, string> = {};
        tableDefinitions.forEach((table) => {
          idToNameMap[table.id] = table.name;
        });

        // Convert data to use table names
        const convertedData = result.data.map((row) => ({
          model_table_name:
            idToNameMap[row.model_table_id] ||
            `unknown_table_${row.model_table_id}`,
          data: row.data,
        }));

        modelData = [...modelData, ...convertedData];
        from += pageSize;
        hasMore = result.data.length === pageSize; // If we got a full page, there might be more
      } else {
        hasMore = false;
      }
    }
  }

  let hasModelData = false;
  if (modelError) {
    console.error("[getReportData] model_data fetch failed:", modelError);
  } else if (modelData && modelData.length > 0) {
    hasModelData = true;

    // Map model data to standard types
    for (const row of modelData) {
      const tableName = row.model_table_name.toLowerCase();
      const data = row.data as any;

      if (
        tableName.includes("transaction") ||
        tableName.includes("payment") ||
        tableName.includes("bank") ||
        tableName.includes("income") ||
        tableName.includes("expense") ||
        tableName.includes("revenue")
      ) {
        // Map to TransactionData
        const amount =
          data.amount ?? data.value ?? data.price ?? data.total ?? 0;
        const date =
          data.date ??
          data.payment_date ??
          data.created_date ??
          data.created_at ??
          "";

        // Filter by date if reportPeriod is provided
        if (reportPeriod) {
          if (date < reportPeriod.start || date > reportPeriod.end) continue;
        }

        transactions.push({
          id: data.id ?? `model_${Math.random().toString(36).substr(2, 9)}`,
          date,
          amount,
          category: data.category ?? data.type ?? "Uncategorized",
          name: data.name ?? data.description ?? tableName,
          description: data.description ?? data.name ?? tableName,
        });
      } else if (
        tableName.includes("deal") ||
        tableName.includes("crm") ||
        tableName.includes("opportunity") ||
        tableName.includes("lead") ||
        tableName.includes("pipeline") ||
        tableName.includes("booking")
      ) {
        // Map to CrmDealData
        const amount =
          data.amount ?? data.value ?? data.price ?? data.total ?? 0;
        const closingDate =
          data.closing_date ??
          data.close_date ??
          data.date ??
          data.payment_date ??
          "";

        // Filter by date if reportPeriod is provided
        if (reportPeriod) {
          if (
            closingDate &&
            (closingDate < reportPeriod.start || closingDate > reportPeriod.end)
          )
            continue;
        }

        crmDeals.push({
          id: data.id ?? `model_${Math.random().toString(36).substr(2, 9)}`,
          deal_name:
            data.deal_name ?? data.name ?? data.label ?? "Untitled Deal",
          client_name:
            data.client_name ?? data.customer_name ?? data.name ?? "",
          amount,
          phase: data.phase ?? data.stage ?? data.status ?? "Unknown",
          closing_date: closingDate,
        });
      } else if (
        tableName.includes("budget") ||
        tableName.includes("plan") ||
        tableName.includes("forecast")
      ) {
        // Map to BudgetData
        const value = data.value ?? data.amount ?? data.planned ?? 0;
        const month = data.month ?? data.date ?? "";

        // Filter by date if reportPeriod is provided
        if (reportPeriod) {
          if (month < reportPeriod.start || month > reportPeriod.end) continue;
        }

        budgets.push({
          month,
          category: data.category ?? data.type ?? "General",
          value,
        });
      }
    }
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
  // Use transactionsWithNumericAmounts instead of raw transactions
  const netCash = transactionsWithNumericAmounts.reduce(
    (sum, t) => sum + t.amount,
    0
  );
  const cashRunway = burnRate > 0 ? Math.round(netCash / burnRate) : 0;

  // --- CRM metrics ---
  // Ensure amounts are numbers for CRM deals too
  const crmDealsWithNumericAmounts = (crmDeals || []).map((d) => ({
    ...d,
    amount: typeof d.amount === "string" ? parseFloat(d.amount) : d.amount || 0,
  }));

  // Pipeline value should only include ACTIVE deals (exclude closed won and closed lost)
  // Use normalizeStage to ensure consistency with PipelineSummaryCards component
  const pipelineValue = crmDealsWithNumericAmounts
    .filter((d) => {
      // Check both phase and stage fields, normalize to standard display names
      const normalizedStage = normalizeStage(d.stage || d.phase || "");
      // Only include active pipeline stages, exclude closed deals
      return normalizedStage !== "Deal" && normalizedStage !== "No Deal";
    })
    .reduce((sum, d) => sum + d.amount, 0);

  const openDeals = crmDealsWithNumericAmounts.filter((d) => {
    // Check both phase and stage fields, normalize to standard display names
    const normalizedStage = normalizeStage(d.stage || d.phase || "");
    // Only count active deals, exclude closed deals
    return normalizedStage !== "Deal" && normalizedStage !== "No Deal";
  }).length;

  // --- Budget variance ---
  const budgetSummary = computeBudgetVariance(
    transactions || [],
    budgets || []
  );

  // Fetch user preferences from business_models (company already loaded at top)
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

  return {
    kpis: finalKPIs,
    budgetVariance: budgetSummary,
    transactions,
    crmDeals,
    budgets,
    businessType: (modelRow?.business_type ?? null) as string | null,
    selectedKpiIds: (modelRow?.selected_kpi_ids ?? []) as string[],
    hasModelData,
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
