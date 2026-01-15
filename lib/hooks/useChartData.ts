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

export function useChartData(type: string) {
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

        let chartData: ChartData[] | WaterfallData[] = [];

        switch (type) {
          case "mrr-vs-plan":
            chartData = generateMRRChartData(
              reportData.transactions || [],
              reportData.budgets || []
            );
            break;
          case "burn-rate":
            chartData = generateBurnRateChartData(
              reportData.transactions || []
            );
            break;
          case "income-statement":
            chartData = generateIncomeStatementData(
              reportData.transactions || []
            );
            console.log("[useChartData] Income statement:", {
              transactionsCount: reportData.transactions?.length || 0,
              chartDataLength: chartData.length,
              chartData,
            });
            break;
          case "variance-analysis":
            chartData = generateVarianceAnalysisData(
              reportData.transactions || [],
              reportData.budgets || []
            );
            console.log("[useChartData] Variance analysis:", {
              transactionsCount: reportData.transactions?.length || 0,
              budgetsCount: reportData.budgets?.length || 0,
              chartDataLength: chartData.length,
              chartData,
            });
            break;
          case "ytd-performance":
            chartData = generateYTDPerformanceData(
              reportData.transactions || [],
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
  }, [type]);

  return { data, loading };
}
