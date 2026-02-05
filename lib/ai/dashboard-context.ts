import { createClient } from "@/lib/supabase/server";
import { getReportData } from "@/lib/report-data-service";
import { getCurrencySymbol } from "@/lib/utils/formatters";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TransactionData,
  BudgetData,
  CrmDealData,
} from "@/lib/types/data";
import { getDataTablesByIds } from "@/lib/data-table-service";

export interface DashboardKpi {
  id: string;
  label: string;
  currentValue: number | null;
  unit?: string;
}

export interface DataAvailability {
  hasTransactions: boolean;
  hasBudgets: boolean;
  hasCrmDeals: boolean;
  // Flexible table structure
  modelTables?: {
    [tableName: string]: {
      count: number;
      fields: string[];
      description?: string;
    };
  };
}

export interface DashboardInsight {
  id: string;
  title: string;
  description: string;
  category: "positive" | "warning" | "info" | "action";
}

export interface DashboardContext {
  businessType: string | null;
  selectedKpiIds: string[];
  kpis: DashboardKpi[];
  monthlyRevenue: Record<string, number>;
  dataAvailability: DataAvailability;
  transactionSummary?: {
    totalCount: number;
    positiveCount: number;
    negativeCount: number;
    zeroCount: number;
  } | null;
  insights?: DashboardInsight[];
  // Flexible business model structure
  businessModelTemplate?: {
    key: string;
    name: string;
    description?: string;
    requiredTables?: Array<{
      table_name: string;
      fields: string[];
      required_fields: string[];
      description?: string;
    }>;
    relationships?: Array<{
      from_table: string;
      to_table: string;
      from_field: string;
      to_field: string;
      relationship_type: string;
    }>;
    dataCategories?: Array<{
      id: string;
      name: string;
    }>;
  };
  // Actual data from model tables (summaries and aggregations)
  modelTablesData?: Record<
    string,
    {
      count: number;
      sample?: any[]; // First 10 records as sample
      aggregations?: Record<string, any>; // Field-level aggregations (e.g., status counts)
    }
  >;
}

// Map format to unit string
function getUnitFromFormat(format?: string): string | undefined {
  if (format === "currency") return "currency";
  if (format === "percentage") return "%";
  if (format === "number") return "count";
  if (format === "months") return "months";
  return undefined;
}

// Extract month from date string (YYYY-MM-DD -> YYYY-MM)
function getMonthKey(dateStr: string): string | null {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  } catch {
    return null;
  }
}

// Helper functions to match metrics-grid.tsx logic
function safeParseFloat(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function safeToLowerCase(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (typeof value === "number") return value.toString().toLowerCase();
  return "";
}

function isRecurringRevenue(category: unknown): boolean {
  if (!category) return false;
  const categoryStr = safeToLowerCase(category);
  const recurringCategories = [
    "subscription",
    "monthly",
    "recurring",
    "mrr",
    "wiederk",
  ];
  return recurringCategories.some((cat) => categoryStr.includes(cat));
}

function isRevenue(category: unknown): boolean {
  if (!category) return false;
  const categoryStr = safeToLowerCase(category);
  const revenueCategories = [
    "subscription",
    "consulting",
    "one-time service",
    "service",
    "sales",
    "revenue",
    "wiederk",
  ];
  return revenueCategories.some((cat) => categoryStr.includes(cat));
}

function isCOGS(category: unknown): boolean {
  if (!category) return false;
  const categoryStr = safeToLowerCase(category);
  return categoryStr.includes("cogs");
}

function safeToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// Calculate all metrics using the same logic as metrics-grid.tsx
interface AllMetrics {
  mrr: number;
  arr: number;
  cashBalance: number;
  burnRate: number;
  burnRateLTM: number;
  burnVariance: number;
  ltmRevenue: number;
  contractedRevenue: number;
  grossMargin: number;
  netMargin: number;
  customerCount: number;
  runway: number;
}

function calculateAllMetrics(
  transactions: TransactionData[],
  crmDeals: CrmDealData[]
): AllMetrics {
  if (!transactions || transactions.length === 0) {
    return {
      mrr: 0,
      arr: 0,
      cashBalance: 0,
      burnRate: 0,
      burnRateLTM: 0,
      burnVariance: 0,
      ltmRevenue: 0,
      contractedRevenue: 0,
      grossMargin: 0,
      netMargin: 0,
      customerCount: 0,
      runway: 0,
    };
  }

  // Find the latest transaction to determine the target month
  const now = new Date();
  const latestTransaction = transactions
    .map((t) => {
      try {
        return new Date(t.date);
      } catch {
        return new Date();
      }
    })
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const targetMonth = latestTransaction || now;
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

  // Filter transactions for the target month
  const currentMonthTransactions = transactions.filter((t) => {
    try {
      const date = new Date(t.date);
      return date >= monthStart && date <= monthEnd && !isNaN(date.getTime());
    } catch {
      return false;
    }
  });

  // If no transactions in current month, use all transactions
  const transactionsToUse =
    currentMonthTransactions.length > 0
      ? currentMonthTransactions
      : transactions;

  // Calculate cash balance - sum of ALL transactions
  const cashBalance = Math.round(
    transactions.reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
  );

  // Calculate recurring revenue
  const recurringRevenue = transactionsToUse
    .filter(
      (t) => safeParseFloat(t.amount) > 0 && isRecurringRevenue(t.category)
    )
    .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

  // Calculate total monthly revenue (all revenue categories)
  const totalMonthlyRevenue = transactionsToUse
    .filter((t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category))
    .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

  // If no revenue found with category matching, use ALL positive transactions
  const allPositiveTransactions = transactionsToUse
    .filter((t) => safeParseFloat(t.amount) > 0)
    .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

  // Calculate MRR
  const mrr = Math.round(
    recurringRevenue > 0
      ? recurringRevenue
      : totalMonthlyRevenue > 0
        ? totalMonthlyRevenue
        : allPositiveTransactions
  );
  const arr = mrr * 12;

  // Calculate monthly expenses (excluding COGS)
  const monthlyExpenses = Math.abs(
    transactionsToUse
      .filter((t) => safeParseFloat(t.amount) < 0 && !isCOGS(t.category))
      .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
  );

  // Calculate COGS separately
  const cogs = Math.abs(
    transactionsToUse
      .filter((t) => safeParseFloat(t.amount) < 0 && isCOGS(t.category))
      .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
  );

  // Calculate net burn (expenses minus revenue)
  const revenueForBurn =
    recurringRevenue > 0
      ? recurringRevenue
      : totalMonthlyRevenue > 0
        ? totalMonthlyRevenue
        : allPositiveTransactions;
  const netBurn = monthlyExpenses - revenueForBurn;
  const burnRate = Math.round(Math.max(0, netBurn));

  // Calculate LTM metrics
  const yearAgo = new Date(targetMonth);
  yearAgo.setFullYear(yearAgo.getFullYear() - 1);

  const ltmTransactions = transactions.filter((t) => {
    try {
      const date = new Date(t.date);
      return date > yearAgo && date <= monthEnd && !isNaN(date.getTime());
    } catch {
      return false;
    }
  });

  // Calculate LTM total revenue
  const ltmTotalRevenue = ltmTransactions
    .filter((t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category))
    .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

  const ltmAllPositive = ltmTransactions
    .filter((t) => safeParseFloat(t.amount) > 0)
    .reduce((sum, t) => sum + safeParseFloat(t.amount), 0);

  const ltmMonthlyRevenue = Math.round(
    (ltmTotalRevenue > 0 ? ltmTotalRevenue : ltmAllPositive) / 12
  );

  // Calculate LTM expenses and burn rate
  const ltmTotalExpenses = Math.abs(
    ltmTransactions
      .filter((t) => safeParseFloat(t.amount) < 0 && !isCOGS(t.category))
      .reduce((sum, t) => sum + safeParseFloat(t.amount), 0)
  );

  const ltmMonthlyExpenses = ltmTotalExpenses / 12;
  const ltmNetBurn = ltmMonthlyExpenses - ltmMonthlyRevenue;
  const burnRateLTM = Math.round(Math.max(0, ltmNetBurn));

  // Calculate burn variance
  const burnVariance = netBurn - ltmNetBurn;
  const burnVariancePercent =
    ltmNetBurn > 0 ? Math.round((burnVariance / ltmNetBurn) * 100) : 0;

  // Calculate contracted revenue from CRM
  const contractedRevenue = Math.round(
    crmDeals
      .filter((d) =>
        ["Negotiation", "Deal", "Closed", "Contract", "Closed Won"].includes(
          safeToString(d.phase)
        )
      )
      .reduce((sum, d) => sum + safeParseFloat(d.amount), 0)
  );

  // Calculate gross margin
  const revenueForMargin =
    recurringRevenue > 0
      ? recurringRevenue
      : totalMonthlyRevenue > 0
        ? totalMonthlyRevenue
        : allPositiveTransactions;
  const grossMargin =
    revenueForMargin > 0
      ? Math.round(((revenueForMargin - cogs) / revenueForMargin) * 100)
      : 0;

  // Calculate net margin
  const netMargin =
    revenueForMargin > 0
      ? Math.round(
          ((revenueForMargin - monthlyExpenses - cogs) / revenueForMargin) * 100
        )
      : 0;

  // Calculate unique customers
  const customerCount =
    crmDeals.length > 0
      ? new Set(
          crmDeals
            .map((d) =>
              safeToLowerCase(d.client_name || d.clientName || "").trim()
            )
            .filter((name) => name !== "")
        ).size
      : new Set(
          transactions
            .filter(
              (t) => safeParseFloat(t.amount) > 0 && isRevenue(t.category)
            )
            .map((t) => safeToLowerCase(t.name || t.description || "").trim())
            .filter((name) => name !== "")
        ).size;

  // Calculate runway
  const monthlyBurnRate = Math.max(0, netBurn);
  const runway =
    monthlyBurnRate > 0 && cashBalance > 0
      ? Math.round(cashBalance / monthlyBurnRate)
      : ltmMonthlyExpenses > 0
        ? Math.round(cashBalance / ltmMonthlyExpenses)
        : 0;

  return {
    mrr,
    arr,
    cashBalance,
    burnRate,
    burnRateLTM,
    burnVariance: burnVariancePercent,
    ltmRevenue: ltmMonthlyRevenue,
    contractedRevenue,
    grossMargin,
    netMargin,
    customerCount,
    runway,
  };
}

export async function buildDashboardContextForUser(
  userId: string,
  supabase?: SupabaseClient
): Promise<DashboardContext> {
  // Use provided supabase client or create a new one
  const client = supabase || (await createClient());

  try {
    // Get user's currency preference from profile
    const { data: profile } = await client
      .from("profiles")
      .select("currency")
      .eq("user_id", userId)
      .single();

    const userCurrencyCode = profile?.currency || "EUR";
    const userCurrencySymbol = getCurrencySymbol(userCurrencyCode);

    // Get company and business model template
    const { data: company } = await client
      .from("companies")
      .select("id")
      .eq("created_by", userId)
      .single();

    let businessModelTemplate:
      | DashboardContext["businessModelTemplate"]
      | undefined;
    let modelTablesData: Record<string, any[]> = {};

    if (company) {
      // Get business model to find the template key
      const { data: businessModel } = await client
        .from("business_models")
        .select("business_type")
        .eq("company_id", company.id)
        .single();

      if (businessModel?.business_type) {
        // Fetch the business model template
        const { data: template } = await client
          .from("business_model_templates")
          .select(
            "key, name, description, required_tables_data, required_table_ids, required_relationships, data_categories"
          )
          .eq("key", businessModel.business_type)
          .single();

        if (template) {
          // Fetch data tables using new ID-based approach or fall back to legacy inline data
          let requiredTables: any[] = [];

          if (
            template.required_table_ids &&
            template.required_table_ids.length > 0
          ) {
            // NEW: Fetch tables from centralized data_tables
            const dataTables = await getDataTablesByIds(
              template.required_table_ids
            );
            requiredTables = dataTables.map((table) => ({
              table_name: table.name,
              fields: table.fields.map((f) => f.name),
              required_fields: table.fields
                .filter((f) => f.required)
                .map((f) => f.name),
              description: table.description,
            }));
          } else if (template.required_tables_data) {
            // LEGACY: Use inline table definitions
            try {
              if (typeof template.required_tables_data === "string") {
                requiredTables = JSON.parse(template.required_tables_data);
              } else if (Array.isArray(template.required_tables_data)) {
                requiredTables = template.required_tables_data;
              }
            } catch (e) {
              console.error(
                "[buildDashboardContextForUser] Failed to parse required_tables_data:",
                e
              );
            }
          }

          // Parse relationships
          let relationships: any[] = [];
          try {
            if (typeof template.required_relationships === "string") {
              relationships = JSON.parse(template.required_relationships);
            } else if (Array.isArray(template.required_relationships)) {
              relationships = template.required_relationships;
            }
          } catch (e) {
            console.error(
              "[buildDashboardContextForUser] Failed to parse required_relationships:",
              e
            );
          }

          // Parse data categories
          let dataCategories: any[] = [];
          try {
            if (typeof template.data_categories === "string") {
              dataCategories = JSON.parse(template.data_categories);
            } else if (Array.isArray(template.data_categories)) {
              dataCategories = template.data_categories;
            }
          } catch (e) {
            console.error(
              "[buildDashboardContextForUser] Failed to parse data_categories:",
              e
            );
          }

          businessModelTemplate = {
            key: template.key,
            name: template.name,
            description: template.description || undefined,
            requiredTables: requiredTables.map((t: any) => ({
              table_name: t.table_name,
              fields: t.fields || [],
              required_fields: t.required_fields || [],
              description: t.description,
            })),
            relationships: relationships.map((r: any) => ({
              from_table: r.from_table,
              to_table: r.to_table,
              from_field: r.from_field,
              to_field: r.to_field,
              relationship_type: r.relationship_type,
            })),
            dataCategories: dataCategories.map((c: any) => ({
              id: c.id,
              name: c.name,
            })),
          };
        }
      }

      // Fetch data from model_data for each table
      // Fetch ALL data, regardless of whether template exists (in case there are additional tables)
      // Fetch with pagination to get all records (Supabase default limit is 1000)
      let allModelData: any[] = [];
      let from = 0;
      const pageSize = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data: modelDataPage, error: modelDataError } = await client
          .from("model_data")
          .select("model_table_name, data")
          .eq("company_id", company.id)
          .range(from, from + pageSize - 1)
          .order("id", { ascending: true });

        if (modelDataError) {
          console.error(
            `[buildDashboardContextForUser] Error fetching model data (page ${from}-${from + pageSize}):`,
            modelDataError
          );
          hasMore = false;
          break;
        }

        if (modelDataPage && modelDataPage.length > 0) {
          allModelData = [...allModelData, ...modelDataPage];
          from += pageSize;
          hasMore = modelDataPage.length === pageSize; // If we got a full page, there might be more
        } else {
          hasMore = false;
        }
      }

      const modelData = allModelData;

      if (modelData && modelData.length > 0) {
        // Group data by table name
        for (const row of modelData) {
          const tableName = row.model_table_name;
          if (!modelTablesData[tableName]) {
            modelTablesData[tableName] = [];
          }
          modelTablesData[tableName].push(row.data);
        }
        console.log(`[buildDashboardContextForUser] Fetched model data:`, {
          totalRows: modelData.length,
          tables: Object.keys(modelTablesData),
          tableCounts: Object.fromEntries(
            Object.entries(modelTablesData).map(([k, v]) => [k, v.length])
          ),
        });
      }
    }

    // Get report data using existing service (for backward compatibility)
    const reportData = await getReportData(client, userId);

    // Build KPI summary from report data
    const kpis: DashboardKpi[] = [];

    // Core financial KPIs from reportData.kpis
    if (reportData.kpis) {
      if (reportData.kpis.revenue != null) {
        kpis.push({
          id: "revenue",
          label: "Revenue",
          currentValue: reportData.kpis.revenue,
          unit: userCurrencySymbol,
        });
      }
      if (reportData.kpis.expenses != null) {
        kpis.push({
          id: "expenses",
          label: "Expenses",
          currentValue: reportData.kpis.expenses,
          unit: userCurrencySymbol,
        });
      }
      if (reportData.kpis.netIncome != null) {
        kpis.push({
          id: "net_income",
          label: "Net Income",
          currentValue: reportData.kpis.netIncome,
          unit: userCurrencySymbol,
        });
      }
      if (reportData.kpis.burnRate != null) {
        kpis.push({
          id: "burn_rate",
          label: "Monthly Burn Rate",
          currentValue: reportData.kpis.burnRate,
          unit: userCurrencySymbol,
        });
      }
      if (reportData.kpis.cashRunway != null) {
        kpis.push({
          id: "cash_runway",
          label: "Cash Runway",
          currentValue: reportData.kpis.cashRunway,
          unit: "months",
        });
      }
      if (reportData.kpis.pipelineValue != null) {
        kpis.push({
          id: "pipeline_value",
          label: "Pipeline Value",
          currentValue: reportData.kpis.pipelineValue,
          unit: userCurrencySymbol,
        });
      }
      if (reportData.kpis.openDeals != null) {
        kpis.push({
          id: "open_deals",
          label: "Open Deals",
          currentValue: reportData.kpis.openDeals,
          unit: "count",
        });
      }
    }

    // Aggregate monthly revenue from transactions
    const monthlyRevenue: Record<string, number> = {};
    if (reportData.transactions && Array.isArray(reportData.transactions)) {
      for (const tx of reportData.transactions) {
        // Ensure amount is a number
        const amount =
          typeof tx.amount === "string"
            ? parseFloat(tx.amount)
            : tx.amount || 0;
        if (amount > 0 && tx.date) {
          const monthKey = getMonthKey(tx.date);
          if (monthKey) {
            monthlyRevenue[monthKey] = (monthlyRevenue[monthKey] || 0) + amount;
          }
        }
      }
    }

    // Calculate LTM Avg Revenue (Last Twelve Months Average)
    const now = new Date();
    const targetMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearAgo = new Date(targetMonth);
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const monthEnd = new Date(
      targetMonth.getFullYear(),
      targetMonth.getMonth() + 1,
      0,
      23,
      59,
      59
    );

    const ltmTransactions = (reportData.transactions || []).filter(
      (t: TransactionData) => {
        try {
          const date = new Date(t.date);
          return date >= yearAgo && date <= monthEnd && !isNaN(date.getTime());
        } catch {
          return false;
        }
      }
    );

    const ltmTotalRevenue = ltmTransactions
      .filter((t: TransactionData) => {
        const amt =
          typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0;
        return amt > 0;
      })
      .reduce((sum: number, t: TransactionData) => {
        const amt =
          typeof t.amount === "string" ? parseFloat(t.amount) : t.amount || 0;
        return sum + amt;
      }, 0);

    const ltmAvgRevenue = ltmTotalRevenue / 12;

    // Add LTM Avg Revenue to KPIs if we have data
    if (ltmAvgRevenue > 0) {
      kpis.push({
        id: "ltm_avg_revenue",
        label: "LTM Avg Revenue",
        currentValue: ltmAvgRevenue,
        unit: userCurrencySymbol,
      });
    }

    // Calculate all metrics using the same logic as the dashboard
    const allMetrics = calculateAllMetrics(
      reportData.transactions || [],
      reportData.crmDeals || []
    );

    // Add all calculated metrics to KPIs
    kpis.push({
      id: "mrr",
      label: "Monthly Recurring Revenue (MRR)",
      currentValue: allMetrics.mrr,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "arr",
      label: "Annual Recurring Revenue (ARR)",
      currentValue: allMetrics.arr,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "cash_balance",
      label: "Cash Balance",
      currentValue: allMetrics.cashBalance,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "burn_rate",
      label: "Net Burn Rate",
      currentValue: allMetrics.burnRate,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "burn_rate_ltm",
      label: "LTM Average Burn Rate",
      currentValue: allMetrics.burnRateLTM,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "burn_variance",
      label: "Burn vs LTM (%)",
      currentValue: allMetrics.burnVariance,
      unit: "%",
    });

    kpis.push({
      id: "ltm_revenue",
      label: "LTM Average Revenue",
      currentValue: allMetrics.ltmRevenue,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "contracted_revenue",
      label: "Contracted Revenue",
      currentValue: allMetrics.contractedRevenue,
      unit: userCurrencySymbol,
    });

    kpis.push({
      id: "gross_margin",
      label: "Gross Margin",
      currentValue: allMetrics.grossMargin,
      unit: "%",
    });

    kpis.push({
      id: "net_margin",
      label: "Net Margin",
      currentValue: allMetrics.netMargin,
      unit: "%",
    });

    kpis.push({
      id: "customer_count",
      label: "Customer Count",
      currentValue: allMetrics.customerCount,
      unit: "count",
    });

    kpis.push({
      id: "runway",
      label: "Cash Runway",
      currentValue: allMetrics.runway,
      unit: "months",
    });

    // Process model tables data to create summaries and aggregations
    // Process ALL tables that have data, not just those in requiredTables
    const processedModelTablesData: Record<
      string,
      {
        count: number;
        sample?: any[];
        aggregations?: Record<string, any>;
      }
    > = {};

    // Get all tables that have data
    const allTablesWithData = Object.keys(modelTablesData);
    console.log(
      `[buildDashboardContextForUser] Processing ${allTablesWithData.length} tables with data:`,
      allTablesWithData
    );

    // Process each table that has data (even if not in requiredTables)
    for (const tableName of allTablesWithData) {
      const tableData = modelTablesData[tableName] || [];
      const count = tableData.length;

      if (count > 0) {
        // Find the table definition from businessModelTemplate if it exists
        const tableDef = businessModelTemplate?.requiredTables?.find(
          (t) => t.table_name.toLowerCase() === tableName.toLowerCase()
        );
        let tableFields = tableDef?.fields || [];

        // If no table definition, try to infer fields from the first record
        if (tableFields.length === 0 && tableData.length > 0) {
          const firstRecord = tableData[0] as any;
          tableFields = Object.keys(firstRecord || {});
          console.log(
            `[buildDashboardContextForUser] Inferred fields for table ${tableName}:`,
            tableFields
          );
        }

        // Include sample data (first 10 records)
        const sample = tableData.slice(0, 10);

        // Create aggregations for common fields
        const aggregations: Record<string, any> = {};

        // Check for status field (case-insensitive)
        const statusField = tableFields.find(
          (f) => f.toLowerCase() === "status"
        );
        if (statusField) {
          const statusCounts: Record<string, number> = {};
          for (const record of tableData) {
            // Try both exact field name and lowercase
            const status =
              (record as any)?.[statusField] ?? (record as any)?.status;
            if (status !== undefined && status !== null) {
              const statusStr = String(status).toLowerCase().trim();
              if (statusStr) {
                statusCounts[statusStr] = (statusCounts[statusStr] || 0) + 1;
              }
            }
          }
          if (Object.keys(statusCounts).length > 0) {
            aggregations.status = statusCounts;
          }
        }

        // Also check all fields in the record to find status-like fields
        if (tableData.length > 0 && !aggregations.status) {
          const firstRecord = tableData[0] as any;
          const recordKeys = Object.keys(firstRecord || {});
          const statusLikeField = recordKeys.find((k) =>
            k.toLowerCase().includes("status")
          );
          if (statusLikeField) {
            const statusCounts: Record<string, number> = {};
            for (const record of tableData) {
              const status = (record as any)?.[statusLikeField];
              if (status !== undefined && status !== null) {
                const statusStr = String(status).toLowerCase().trim();
                if (statusStr) {
                  statusCounts[statusStr] = (statusCounts[statusStr] || 0) + 1;
                }
              }
            }
            if (Object.keys(statusCounts).length > 0) {
              aggregations.status = statusCounts;
            }
          }
        }

        // Count by type field (if exists)
        if (
          tableFields.includes("type") ||
          tableFields.some((f) => f.toLowerCase() === "type")
        ) {
          const typeCounts: Record<string, number> = {};
          for (const record of tableData) {
            const type = (record as any)?.type;
            if (type !== undefined && type !== null) {
              const typeStr = String(type).toLowerCase();
              typeCounts[typeStr] = (typeCounts[typeStr] || 0) + 1;
            }
          }
          if (Object.keys(typeCounts).length > 0) {
            aggregations.type = typeCounts;
          }
        }

        // Sum amounts if amount field exists
        if (
          tableFields.includes("amount") ||
          tableFields.some((f) => f.toLowerCase() === "amount")
        ) {
          let totalAmount = 0;
          for (const record of tableData) {
            const amount = (record as any)?.amount;
            if (amount !== undefined && amount !== null) {
              const numAmount =
                typeof amount === "string" ? parseFloat(amount) : amount;
              if (!isNaN(numAmount)) {
                totalAmount += numAmount;
              }
            }
          }
          if (totalAmount !== 0) {
            aggregations.totalAmount = totalAmount;
          }
        }

        processedModelTablesData[tableName] = {
          count,
          sample,
          aggregations:
            Object.keys(aggregations).length > 0 ? aggregations : undefined,
        };

        // Log for debugging
        console.log(
          `[buildDashboardContextForUser] Processed table ${tableName}:`,
          {
            count,
            sampleCount: sample.length,
            aggregations:
              Object.keys(aggregations).length > 0 ? aggregations : "none",
          }
        );
      } else {
        processedModelTablesData[tableName] = {
          count: 0,
        };
      }
    }

    // Data availability flags
    const dataAvailability: DataAvailability = {
      hasTransactions: (reportData.transactions?.length || 0) > 0,
      hasBudgets: (reportData.budgets?.length || 0) > 0,
      hasCrmDeals: (reportData.crmDeals?.length || 0) > 0,
      // Add flexible model tables
      modelTables: businessModelTemplate
        ? Object.fromEntries(
            (businessModelTemplate.requiredTables || []).map((table) => [
              table.table_name,
              {
                count: modelTablesData[table.table_name]?.length || 0,
                fields: table.fields,
                description: table.description,
              },
            ])
          )
        : undefined,
    };

    // Add transaction summary even if totals are 0
    const transactionSummary =
      reportData.transactions && reportData.transactions.length > 0
        ? {
            totalCount: reportData.transactions.length,
            positiveCount: reportData.transactions.filter(
              (t: TransactionData) => {
                const amt =
                  typeof t.amount === "string"
                    ? parseFloat(t.amount)
                    : t.amount || 0;
                return amt > 0;
              }
            ).length,
            negativeCount: reportData.transactions.filter(
              (t: TransactionData) => {
                const amt =
                  typeof t.amount === "string"
                    ? parseFloat(t.amount)
                    : t.amount || 0;
                return amt < 0;
              }
            ).length,
            zeroCount: reportData.transactions.filter((t: TransactionData) => {
              const amt =
                typeof t.amount === "string"
                  ? parseFloat(t.amount)
                  : t.amount || 0;
              return amt === 0;
            }).length,
          }
        : null;

    // Fetch AI insights from database
    const { data: insightsData } = await client
      .from("dashboard_insights")
      .select("id, title, description, category")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10); // Limit to most recent 10 insights

    const insights: DashboardInsight[] =
      insightsData?.map((insight) => ({
        id: insight.id,
        title: insight.title,
        description: insight.description,
        category: insight.category as DashboardInsight["category"],
      })) || [];

    return {
      businessType: reportData.businessType,
      selectedKpiIds: reportData.selectedKpiIds,
      kpis,
      monthlyRevenue,
      dataAvailability,
      transactionSummary, // Add this to help the AI understand transaction structure
      insights, // Add AI insights to context
      businessModelTemplate, // Add business model template structure
      modelTablesData:
        Object.keys(processedModelTablesData).length > 0
          ? processedModelTablesData
          : undefined, // Add actual data summaries
    };
  } catch (error) {
    console.error("[buildDashboardContextForUser] Error:", error);
    // Return empty context on error
    return {
      businessType: null,
      selectedKpiIds: [],
      kpis: [],
      monthlyRevenue: {},
      dataAvailability: {
        hasTransactions: false,
        hasBudgets: false,
        hasCrmDeals: false,
        modelTables: undefined,
      },
      transactionSummary: null,
      insights: [],
      businessModelTemplate: undefined,
      modelTablesData: undefined,
    };
  }
}
