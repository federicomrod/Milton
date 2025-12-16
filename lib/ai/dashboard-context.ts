import { createClient } from "@/lib/supabase/server";
import type { BusinessTypeId } from "@/lib/business-types";
import { getReportData } from "@/lib/report-data-service";

export interface DashboardKpi {
  id: string;
  label: string;
  currentValue: number | null;
  unit?: string;
}

export interface DataAvailability {
  hasKpiSnapshots: boolean;
  hasTransactions: boolean;
  hasBudgets: boolean;
  hasCrmDeals: boolean;
}

export interface DashboardContext {
  businessType: BusinessTypeId | null;
  selectedKpiIds: string[];
  kpis: DashboardKpi[];
  monthlyRevenue: Record<string, number>;
  dataAvailability: DataAvailability;
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
  userId: string
): Promise<DashboardContext> {
  const supabase = await createClient();

  try {
    // Get report data using existing service
    const reportData = await getReportData(supabase, userId);

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
        if (tx.amount > 0 && tx.date) {
          const monthKey = getMonthKey(tx.date);
          if (monthKey) {
            monthlyRevenue[monthKey] =
              (monthlyRevenue[monthKey] || 0) + tx.amount;
          }
        }
      }
    }

    // Data availability flags
    const dataAvailability: DataAvailability = {
      hasKpiSnapshots: kpis.length > 0,
      hasTransactions: (reportData.transactions?.length || 0) > 0,
      hasBudgets: (reportData.budgets?.length || 0) > 0,
      hasCrmDeals: (reportData.crmDeals?.length || 0) > 0,
    };

    return {
      businessType: reportData.businessType,
      selectedKpiIds: reportData.selectedKpiIds,
      kpis,
      monthlyRevenue,
      dataAvailability,
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
        hasKpiSnapshots: false,
        hasTransactions: false,
        hasBudgets: false,
        hasCrmDeals: false,
      },
    };
  }
}
