// lib/fitness-studio-report-data.ts
// Service to fetch fitness studio data for PDF reports

export interface FitnessStudioKpis {
  activeMembers: number;
  newMembers: number;
  churnedMembers: number;
  churnRate: number;
  avgTenure: number;
  revenuePerMember: number;
  utilizationRate: number;
  cancellationRate: number;
  noShowRate?: number;
  totalClassesHeld?: number;
  avgClassOccupancy?: number;
  capacityUtilization?: number;
  avgAttendeesPerClass?: number;
  revenuePerClass?: number;
  totalMembers?: number;
  netMemberGrowth?: number;
  engagementRate?: number;
  activeInstructors?: number;
  classesTaught?: number;
  avgOccupancyPerInstructor?: number;
  revenuePerInstructor?: number;
  instructorCancellationRate?: number;
  totalRevenue?: number;
  totalCosts?: number;
  netIncome?: number;
  grossMargin?: number;
  netCashFlow?: number;
  burnRate?: number;
  runway?: number;
}

export interface FitnessStudioChartData {
  period: string;
  value?: number;
  newMembers?: number;
  churnedMembers?: number;
  revenue?: number;
  occupancy?: number;
  utilization?: number;
  [key: string]: any;
}

/**
 * Fetch fitness studio KPIs for a given date range
 * Aggregates data from multiple endpoints
 */
export async function fetchFitnessStudioKpis(
  fromDate: string,
  toDate: string
): Promise<FitnessStudioKpis> {
  try {
    // Fetch from multiple endpoints in parallel
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

    // Merge KPIs from all sources
    const allKpis: Partial<FitnessStudioKpis> = {};

    if (kpisRes.ok) {
      const kpisJson = await kpisRes.json();
      console.log("[fetchFitnessStudioKpis] KPIs API response:", {
        hasKpis: !!kpisJson.kpis,
        kpiKeys: kpisJson.kpis ? Object.keys(kpisJson.kpis) : [],
        kpiValues: kpisJson.kpis,
      });
      if (kpisJson.kpis) {
        Object.assign(allKpis, kpisJson.kpis);
      }
    } else {
      console.warn(
        "[fetchFitnessStudioKpis] KPIs API error:",
        kpisRes.status,
        await kpisRes.text().catch(() => "")
      );
    }

    if (classesRes.ok) {
      const classesJson = await classesRes.json();
      console.log("[fetchFitnessStudioKpis] Classes API response:", {
        hasKpis: !!classesJson.kpis,
        kpiKeys: classesJson.kpis ? Object.keys(classesJson.kpis) : [],
        kpiValues: classesJson.kpis,
      });
      if (classesJson.kpis) {
        Object.assign(allKpis, classesJson.kpis);
      }
    } else {
      console.warn(
        "[fetchFitnessStudioKpis] Classes API error:",
        classesRes.status,
        await classesRes.text().catch(() => "")
      );
    }

    // Calculate financial KPIs from transactions if needed
    // These would come from the report-data-service, but we'll add them here
    // For now, we'll rely on the API endpoints

    console.log("[fetchFitnessStudioKpis] Final merged KPIs:", {
      keys: Object.keys(allKpis),
      sampleValues: Object.entries(allKpis)
        .slice(0, 10)
        .map(([k, v]) => ({ [k]: v })),
      totalKeys: Object.keys(allKpis).length,
    });
    return allKpis as FitnessStudioKpis;
  } catch (error) {
    console.error("[fetchFitnessStudioKpis] Error:", error);
    return {} as FitnessStudioKpis;
  }
}

/**
 * Map report chart ID to API chart type
 * Only maps to chart types that are actually implemented in the API
 */
function mapChartTypeToApi(chartId: string): string | null {
  const mapping: Record<string, string> = {
    // Executive Overview
    membersOverTime: "member-count",
    revenueTrend: "revenue-per-member", // Using revenue per member as proxy for revenue trend
    // Studio Performance
    newVsChurned: "new-vs-churned",
    churnRateTrend: "new-vs-churned", // Can derive churn rate from new-vs-churned data
    revenuePerMemberTrend: "revenue-per-member",
    utilizationHeatmap: "utilization-heatmap",
    // Classes & Utilization
    occupancyTrend: "occupancy-trend",
    utilizationTrend: "utilization-heatmap", // Using heatmap data for utilization trend
    classOutcomes: "class-outcomes",
    top10ClassesByOccupancy: "top10-classes-occupancy",
    top10ClassesByRevenue: "top10-classes-revenue",
    // Members
    memberBaseOverTime: "member-count",
    // Note: The following charts are not yet implemented in the API:
    // - tenureDistribution, subscriptionTypeSplit, genderSplit, ageBands, engagementDistribution (Members)
    // - instructorRankingByRevenue, instructorRankingByOccupancy, classesTaughtPerInstructor, cancellationRateByInstructor (Instructors)
    // - netIncomeTrend, revenueBreakdown, costBreakdown, budgetVsActual (Financials)
    // - inflowsVsOutflows, netCashFlowTrend, cumulativeCashFlow, outflowsByCategory (Cash Flow)
    // These will show "coming soon" placeholders until implemented
  };

  // Return null for charts that don't have API support yet
  // This will allow the code to show a placeholder instead of wrong data
  return mapping[chartId] || null;
}

/**
 * Fetch fitness studio chart data for a given chart type and date range
 */
export async function fetchFitnessStudioChart(
  chartType: string,
  fromDate: string,
  toDate: string
): Promise<FitnessStudioChartData[] | null> {
  try {
    // Map chart ID to API chart type
    const apiChartType = mapChartTypeToApi(chartType);

    // If chart type is not supported, return null to indicate it should show placeholder
    if (!apiChartType) {
      console.warn(
        `[fetchFitnessStudioChart] Chart type "${chartType}" is not yet implemented in the API. Showing placeholder.`
      );
      return null;
    }

    const response = await fetch(
      `/api/analytics/fitness-studio/charts?chart=${apiChartType}&from_date=${fromDate}&to_date=${toDate}`,
      { cache: "no-store", credentials: "include" }
    );

    if (!response.ok) {
      console.warn(
        `[fetchFitnessStudioChart] API error for ${chartType} (${apiChartType}):`,
        response.status
      );
      return null;
    }

    const json = await response.json();
    console.log(
      `[fetchFitnessStudioChart] Fetched ${chartType} (${apiChartType}):`,
      json.data?.length || 0,
      "data points"
    );
    return json.data || [];
  } catch (error) {
    console.error(`[fetchFitnessStudioChart] Error for ${chartType}:`, error);
    return null;
  }
}

/**
 * Fetch classes & utilization KPIs
 */
export async function fetchClassesUtilizationKpis(
  fromDate: string,
  toDate: string
): Promise<Partial<FitnessStudioKpis>> {
  try {
    const response = await fetch(
      `/api/analytics/fitness-studio/classes-utilization?from_date=${fromDate}&to_date=${toDate}`,
      { cache: "no-store", credentials: "include" }
    );

    if (!response.ok) {
      return {};
    }

    const json = await response.json();
    return json.kpis || {};
  } catch (error) {
    console.error("[fetchClassesUtilizationKpis] Error:", error);
    return {};
  }
}

/**
 * Get KPI value by card ID
 */
export function getKpiValue(
  kpis: FitnessStudioKpis | any,
  cardId: string
): number | string | null {
  const mapping: Record<string, string | string[]> = {
    // Executive Overview
    activeMembers: "activeMembers",
    monthlyRevenue: ["totalRevenue", "revenue"], // From kpis API
    netIncome: ["netIncome", "net_income"], // From kpis API
    utilizationRate: "utilizationRate", // From kpis API - "Studio Utilization" in dashboard
    monthlyChurnRate: "churnRate", // From kpis API
    cashRunway: ["runway", "cashRunway"], // Not in fitness studio APIs, falls back to reportData
    // Studio Performance
    newMembers: "newMembers",
    avgMemberTenure: ["avgTenure", "avgTenure"],
    revenuePerMember: ["revenuePerMember", "revenue_per_member"],
    cancellationRate: "cancellationRate",
    noShowRate: "noShowRate",
    // Classes & Utilization - from classes-utilization API
    totalClassesHeld: "totalClassesHeld", // Not in API - will show N/A
    avgClassOccupancy: ["avgClassOccupancy", "averageClassSize"], // Both returned by classes-utilization API
    capacityUtilization: "capacityUtilization", // From classes-utilization API - "Capacity Utilization" in dashboard
    avgAttendeesPerClass: ["avgClassOccupancy", "averageClassSize"], // Same as avgClassOccupancy
    revenuePerClass: "revenuePerClass", // From classes-utilization API
    // Members
    totalMembers: ["totalMembers", "activeMembers"], // Fallback to activeMembers
    netMemberGrowth: "netMemberGrowth",
    engagementRate: "engagementRate",
    // Instructors
    activeInstructors: "activeInstructors",
    classesTaught: "classesTaught",
    avgOccupancyPerInstructor: "avgOccupancyPerInstructor",
    revenuePerInstructor: "revenuePerInstructor",
    instructorCancellationRate: "instructorCancellationRate",
    // Financials
    totalRevenue: ["totalRevenue", "revenue"],
    totalCosts: ["totalCosts", "expenses", "costs"],
    grossMargin: "grossMargin",
    // Cash Flow
    netCashFlow: "netCashFlow",
    burnRate: "burnRate",
    runway: ["runway", "cashRunway"],
  };

  const keyOrKeys = mapping[cardId];
  if (!keyOrKeys) {
    console.warn(`[getKpiValue] No mapping for cardId: ${cardId}`);
    return null;
  }

  // Try multiple keys if array, otherwise single key
  const keysToTry = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

  for (const key of keysToTry) {
    const value = kpis?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return typeof value === "number" ? value : String(value);
    }
  }

  // If we get here, none of the keys had a value
  console.warn(
    `[getKpiValue] No value found for ${cardId}, tried keys: ${keysToTry.join(", ")}, available keys:`,
    Object.keys(kpis || {})
  );
  return null;
}
