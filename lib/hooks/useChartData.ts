import { useEffect, useState } from "react";
import type { ChartData, WaterfallData } from "@/lib/chart-data-generators";

export function useChartData(
  type: string,
  period: "month" | "year" | "ytd" | "custom" = "month",
  customDateRange?: { from: string; to: string }
) {
  const [data, setData] = useState<ChartData[] | WaterfallData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        // Calculate date range based on period
        let toDate = new Date();
        let fromDate = new Date();

        if (period === "year") {
          fromDate = new Date(new Date().getFullYear() - 1, 0, 1); // January 1st of last year
          toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59); // December 31st of last year
        } else if (period === "ytd") {
          fromDate = new Date(new Date().getFullYear(), 0, 1); // January 1st of current year
        } else if (period === "custom" && customDateRange) {
          fromDate = new Date(customDateRange.from);
          toDate = new Date(customDateRange.to);
        } else {
          // month - default to last 12 months for charts
          fromDate.setMonth(fromDate.getMonth() - 12);
        }

        const fromDateStr = fromDate.toISOString().split("T")[0];
        const toDateStr = toDate.toISOString().split("T")[0];

        // Map chart type to API chart type
        const apiChartType =
          type === "income-statement"
            ? "income-statement"
            : type === "variance-analysis"
              ? "variance-analysis"
              : type === "ytd-performance"
                ? "ytd-performance"
                : null;

        // Only fetch from API for fitness studio financial charts
        // Other chart types (mrr-vs-plan, burn-rate) can use the old method if needed
        if (apiChartType) {
          const response = await fetch(
            `/api/analytics/fitness-studio/financials?chart=${apiChartType}&from_date=${fromDateStr}&to_date=${toDateStr}`,
            { cache: "no-store", credentials: "include" }
          );

          if (!response.ok) {
            console.error(
              `[useChartData] API error for ${type}:`,
              response.status
            );
            setData([]);
            setLoading(false);
            return;
          }

          const json = await response.json();
          setData(json.data || []);
          setLoading(false);
          return;
        }

        // For other chart types, return empty for now (they may not be used in fitness studio)
        setData([]);
        setLoading(false);
      } catch (error) {
        console.error("useChartData: Error loading data", error);
        setData([]);
        setLoading(false);
      }
    };

    loadData();
  }, [type, period, customDateRange]);

  return { data, loading };
}
