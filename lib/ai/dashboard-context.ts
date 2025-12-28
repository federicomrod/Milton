import { createClient } from "@/lib/supabase/server";
import { getReportData } from "@/lib/report-data-service";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  TransactionData,
  BudgetData,
  CrmDealData,
} from "@/lib/types/data";

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

export async function buildDashboardContextForUser(
  userId: string,
  supabase?: SupabaseClient
): Promise<DashboardContext> {
  // Use provided supabase client or create a new one
  const client = supabase || (await createClient());

  try {
    // Get report data using existing service
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
          unit: "currency",
        });
      }
      if (reportData.kpis.expenses != null) {
        kpis.push({
          id: "expenses",
          label: "Expenses",
          currentValue: reportData.kpis.expenses,
          unit: "currency",
        });
      }
      if (reportData.kpis.netIncome != null) {
        kpis.push({
          id: "net_income",
          label: "Net Income",
          currentValue: reportData.kpis.netIncome,
          unit: "currency",
        });
      }
      if (reportData.kpis.burnRate != null) {
        kpis.push({
          id: "burn_rate",
          label: "Monthly Burn Rate",
          currentValue: reportData.kpis.burnRate,
          unit: "currency",
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
          unit: "currency",
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
        unit: "currency",
      });
    }

    // Data availability flags
    const dataAvailability: DataAvailability = {
      hasTransactions: (reportData.transactions?.length || 0) > 0,
      hasBudgets: (reportData.budgets?.length || 0) > 0,
      hasCrmDeals: (reportData.crmDeals?.length || 0) > 0,
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

    return {
      businessType: reportData.businessType,
      selectedKpiIds: reportData.selectedKpiIds,
      kpis,
      monthlyRevenue,
      dataAvailability,
      transactionSummary, // Add this to help the AI understand transaction structure
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
      },
      transactionSummary: null,
    };
  }
}
