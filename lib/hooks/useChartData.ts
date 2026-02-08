import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getReportData } from "@/lib/report-data-service";
import {
  generateMRRChartData,
  generateBurnRateChartData,
  generateVarianceAnalysisData,
  generateYTDPerformanceData,
  generateIncomeStatementData,
  type ChartData,
  type WaterfallData,
} from "@/lib/chart-data-generators";

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

        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          console.error("useChartData: Error getting user", userError);
          setLoading(false);
          return;
        }

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

        const reportData = await getReportData(supabase, user.id);

        // For variance-analysis and ytd-performance, we need budgets OR transactions
        // For other charts, we need transactions
        const needsTransactions = ![
          "variance-analysis",
          "ytd-performance",
        ].includes(type);

        if (
          needsTransactions &&
          (!reportData.transactions || reportData.transactions.length === 0)
        ) {
          setData([]);
          setLoading(false);
          return;
        }

        // For variance-analysis, check if we have at least budgets or transactions
        if (type === "variance-analysis") {
          const hasTransactions =
            reportData.transactions && reportData.transactions.length > 0;
          const hasBudgets =
            reportData.budgets && reportData.budgets.length > 0;
          if (!hasTransactions && !hasBudgets) {
            setData([]);
            setLoading(false);
            return;
          }
        }

        // Filter transactions by date range
        const filteredTransactions = (reportData.transactions || []).filter(
          (t) => {
            try {
              const date = new Date(t.date);
              return (
                date >= fromDate && date <= toDate && !isNaN(date.getTime())
              );
            } catch {
              return false;
            }
          }
        );

        let chartData: ChartData[] | WaterfallData[] = [];

        switch (type) {
          case "mrr-vs-plan":
            chartData = generateMRRChartData(
              filteredTransactions,
              reportData.budgets || []
            );
            break;
          case "burn-rate":
            chartData = generateBurnRateChartData(filteredTransactions);
            break;
          case "income-statement":
            chartData = generateIncomeStatementData(filteredTransactions);
            console.log("[useChartData] Income statement:", {
              transactionsCount: filteredTransactions.length,
              chartDataLength: chartData.length,
              chartData,
            });
            break;
          case "variance-analysis":
            chartData = generateVarianceAnalysisData(
              filteredTransactions,
              reportData.budgets || []
            );
            console.log("[useChartData] Variance analysis:", {
              transactionsCount: filteredTransactions.length,
              budgetsCount: reportData.budgets?.length || 0,
              chartDataLength: chartData.length,
              chartData,
            });
            break;
          case "ytd-performance":
            chartData = generateYTDPerformanceData(
              filteredTransactions,
              reportData.budgets || []
            );
            break;
          default:
            chartData = [];
        }

        setData(chartData);
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
