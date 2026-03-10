import { createClient } from "@/lib/supabase/client";

export interface AnalyticsKpiData {
  [key: string]: number | null;
}

/**
 * Fetches KPI data from analytics APIs based on business model
 */
export async function fetchDashboardKpis(
  period: "month" | "year" | "ytd" | "custom",
  customDateRange?: { from: string; to: string },
  selectedKpiIds: string[] = []
): Promise<Record<string, number | null>> {
  try {
    // Get business model
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return {};
    }

    const { data: company } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (!company) {
      return {};
    }

    const { data: businessModel } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", company.id)
      .single();

    const businessType = businessModel?.business_type;

    // Calculate date range
    let fromDate: string;
    let toDate: string;

    if (period === "custom" && customDateRange) {
      fromDate = customDateRange.from;
      toDate = customDateRange.to;
    } else if (period === "year") {
      const now = new Date();
      fromDate = new Date(now.getFullYear() - 1, 0, 1)
        .toISOString()
        .split("T")[0];
      toDate = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59)
        .toISOString()
        .split("T")[0];
    } else if (period === "ytd") {
      fromDate = new Date(new Date().getFullYear(), 0, 1)
        .toISOString()
        .split("T")[0];
      toDate = new Date().toISOString().split("T")[0];
    } else {
      // month - last 6 months for broader data
      fromDate = new Date(new Date().setMonth(new Date().getMonth() - 6))
        .toISOString()
        .split("T")[0];
      toDate = new Date().toISOString().split("T")[0];
    }

    // Call appropriate analytics API based on business model
    let analyticsData: Record<string, number> = {};

    if (businessType === "fitness_studio") {
      const [kpisRes, classesRes] = await Promise.all([
        fetch(
          `/api/analytics/fitness-studio/kpis?from_date=${fromDate}&to_date=${toDate}`,
          { cache: "no-store", credentials: "include" }
        ),
        fetch(
          `/api/analytics/fitness-studio/classes-utilization?from_date=${fromDate}&to_date=${toDate}`,
          { cache: "no-store", credentials: "include" }
        ),
      ]);

      if (kpisRes.ok) {
        const kpisJson = await kpisRes.json();
        analyticsData = { ...analyticsData, ...(kpisJson.kpis || {}) };
      } else {
        console.error(`Failed to fetch fitness-studio KPIs:`, kpisRes.status);
      }

      if (classesRes.ok) {
        const classesJson = await classesRes.json();
        analyticsData = {
          ...analyticsData,
          ...(classesJson.kpis || {}),
        };
      } else {
        console.error(
          `Failed to fetch classes-utilization KPIs:`,
          classesRes.status
        );
      }
    } else if (businessType === "restaurant") {
      const response = await fetch(
        `/api/analytics/restaurant/kpis?from_date=${fromDate}&to_date=${toDate}`,
        { cache: "no-store", credentials: "include" }
      );
      if (response.ok) {
        const data = await response.json();
        analyticsData = data.kpis || {};
      } else {
        console.error(`Failed to fetch restaurant KPIs:`, response.status);
      }
    } else {
      return {};
    }

    // If we have selected KPIs, map analytics fields to KPI IDs
    if (selectedKpiIds.length > 0 && businessType) {
      const mappings = DASHBOARD_KPI_MAPPINGS[businessType];
      const result: Record<string, number | null> = {};

      // Filter out non-UUID legacy identifiers
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const validKpiIds = selectedKpiIds.filter((id) => uuidRegex.test(id));

      if (validKpiIds.length > 0) {
        // Get KPI definitions to map names to IDs
        const { data: kpis } = await supabase
          .from("kpis")
          .select("id, name")
          .in("id", validKpiIds);

        if (kpis) {
          kpis.forEach((kpi) => {
            const apiField = mappings[kpi.name];
            const value = analyticsData[apiField];
            if (apiField && value !== undefined) {
              result[kpi.id] = value;
            } else {
              result[kpi.id] = null;
            }
          });
        }
      }

      return result;
    }

    return analyticsData;
  } catch (error) {
    console.error("Error fetching dashboard KPIs:", error);
    return {};
  }
}

/**
 * Maps generic KPI names to analytics API field names
 * This provides a unified interface for the dashboard
 */
export const DASHBOARD_KPI_MAPPINGS: Record<string, Record<string, string>> = {
  fitness_studio: {
    "Active Members (End of Month)": "activeMembers",
    "New Members": "newMembers",
    "Churned Members": "churnedMembers",
    "Churn Rate": "churnRate",
    "Member Tenure": "avgTenure",
    "Revenue per Member (ARPM)": "revenuePerMember",
    "Studio Utilization": "utilizationRate",
    "Utilization Rate": "utilizationRate",
    "Occupancy Rate": "utilizationRate",
    "Capacity Utilization": "capacityUtilization",
    "Average Class Size": "averageClassSize",
    "Average Class Occupancy": "avgClassOccupancy",
    "Class Attendance Rate": "avgClassOccupancy",
    "Cancellation Rate": "cancellationRate",
    "No Show Rate": "noShowRate",
    "Revenue per Class": "revenuePerClass",
    "Total Expenses": "totalCosts",
    "Total Revenue": "totalRevenue",
    "Revenue Growth Rate": "revenueGrowthRate",
    "Net Income": "netIncome",
    "Net Cash Flow": "netCashFlow",
    "Burn Rate": "burnRate",
    "Total Classes Held": "totalClassesHeld",
  },
  restaurant: {
    "Total Revenue": "totalRevenue",
    "Covers (Guests Served)": "covers",
    Covers: "covers",
    "Average Ticket Size": "averageTicketSize",
    "Average Order Value (AOV)": "averageOrderValue",
    "Average Order Value": "averageOrderValue",
    "Prime Cost %": "primeCostPercent",
    "Net Cash Flow": "netCashFlow",
    "Menu Item Margin": "menuItemMargin",
    "Gross Margin": "grossMargin",
  },
};

/**
 * Gets the API field name for a KPI based on the business model
 */
export function getAnalyticsFieldForKpi(
  kpiName: string,
  businessType?: string
): string | null {
  if (!businessType) return null;

  const mappings = DASHBOARD_KPI_MAPPINGS[businessType];
  if (!mappings) return null;

  return mappings[kpiName] || null;
}
