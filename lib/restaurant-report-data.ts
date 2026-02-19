// lib/restaurant-report-data.ts
// Service to fetch restaurant data for PDF reports

export interface RestaurantChartData {
  date?: string;
  revenue?: number;
  category?: string;
  percentage?: number;
  channel?: string;
  name?: string;
  quantity?: number;
  revenueShare?: number;
  margin?: number | null;
  marginPercent?: number | null;
  day?: string;
  covers?: number;
  orders?: number;
  hour?: number;
  hourLabel?: string;
  amount?: number;
  [key: string]: any;
}

/**
 * Map report chart ID to API endpoint and data field
 */
function mapRestaurantChartType(
  chartId: string
): { endpoint: string; dataField: string } | null {
  const mapping: Record<string, { endpoint: string; dataField: string }> = {
    // Restaurant Overview
    salesTrend: {
      endpoint: "revenue-menu",
      dataField: "salesTrends",
    },
    // Revenue & Menu Performance
    salesTrends: {
      endpoint: "revenue-menu",
      dataField: "salesTrends",
    },
    categoryBreakdown: {
      endpoint: "revenue-menu",
      dataField: "categoryBreakdown",
    },
    channelBreakdown: {
      endpoint: "revenue-menu",
      dataField: "channelBreakdown",
    },
    topItems: {
      endpoint: "revenue-menu",
      dataField: "topItems",
    },
    bottomItems: {
      endpoint: "revenue-menu",
      dataField: "bottomItems",
    },
    // Operations
    coversByDay: {
      endpoint: "operations",
      dataField: "coversByDay",
    },
    coversByHour: {
      endpoint: "operations",
      dataField: "coversByHour",
    },
    peakTimes: {
      endpoint: "operations",
      dataField: "peakTimes",
    },
    // Cash Flow
    cashFlowOverview: {
      endpoint: "cash-flow",
      dataField: "inflows", // Will combine inflows and outflows
    },
    inflowsByCategory: {
      endpoint: "cash-flow",
      dataField: "inflows",
    },
    outflowsByCategory: {
      endpoint: "cash-flow",
      dataField: "outflows",
    },
  };

  return mapping[chartId] || null;
}

/**
 * Fetch restaurant chart data for a given chart type and date range
 */
export async function fetchRestaurantChart(
  chartType: string,
  fromDate: string,
  toDate: string
): Promise<RestaurantChartData[] | null> {
  try {
    // Map chart ID to API endpoint and data field
    const chartMapping = mapRestaurantChartType(chartType);

    // If chart type is not supported, return null to indicate it should show placeholder
    if (!chartMapping) {
      console.warn(
        `[fetchRestaurantChart] Chart type "${chartType}" is not yet implemented. Showing placeholder.`
      );
      return null;
    }

    const { endpoint, dataField } = chartMapping;

    const response = await fetch(
      `/api/analytics/restaurant/${endpoint}?from_date=${fromDate}&to_date=${toDate}&period=month`,
      { cache: "no-store", credentials: "include" }
    );

    if (!response.ok) {
      console.warn(
        `[fetchRestaurantChart] API error for ${chartType} (${endpoint}):`,
        response.status
      );
      return null;
    }

    const json = await response.json();

    // Handle special case for cashFlowOverview - combine inflows and outflows
    if (chartType === "cashFlowOverview") {
      const inflows = json.inflows || [];
      const outflows = json.outflows || [];
      return [
        {
          category: "Inflows",
          amount: inflows.reduce(
            (sum: number, item: any) => sum + (item.amount || 0),
            0
          ),
        },
        {
          category: "Outflows",
          amount: Math.abs(
            outflows.reduce(
              (sum: number, item: any) => sum + (item.amount || 0),
              0
            )
          ),
        },
        {
          category: "Net Cash Flow",
          amount: json.netCashFlow || 0,
        },
      ];
    }

    const data = json[dataField];
    console.log(
      `[fetchRestaurantChart] Fetched ${chartType} (${endpoint}/${dataField}):`,
      Array.isArray(data) ? data.length : "not an array",
      "data points"
    );

    return Array.isArray(data) ? data : [];
  } catch (error) {
    console.error(`[fetchRestaurantChart] Error for ${chartType}:`, error);
    return null;
  }
}
