"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WaterfallChart } from "@/components/dashboard/waterfall-chart";
import { useChartData } from "@/lib/hooks/useChartData";
import { MRRChart } from "@/components/dashboard/charts/MRRChart";
import { BurnRateChart } from "@/components/dashboard/charts/BurnRateChart";
import { VarianceAnalysisChart } from "@/components/dashboard/charts/VarianceAnalysisChart";
import { YTDPerformanceChart } from "@/components/dashboard/charts/YTDPerformanceChart";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import type { ChartData, WaterfallData } from "@/lib/chart-data-generators";

interface ChartProps {
  type:
    | "mrr-vs-plan"
    | "burn-rate"
    | "income-statement"
    | "variance-analysis"
    | "ytd-performance";
  period?: "month" | "year" | "ytd" | "custom";
  customDateRange?: { from: string; to: string };
  onPeriodChange?: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange?: (range: { from: string; to: string }) => void;
  showDatePicker?: boolean;
}

const CHART_TITLES = {
  "mrr-vs-plan": "MRR: Plan vs Actual & LTM Comparison",
  "burn-rate": "Monthly Burn Rate Trend",
  "income-statement": "Income Statement Overview",
  "variance-analysis": "Budget Variance Analysis",
  "ytd-performance": "Year-to-Date Performance",
};

export function FinancialCharts({
  type,
  period = "month",
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
  showDatePicker = false,
}: ChartProps) {
  const { data } = useChartData(type, period, customDateRange);

  const renderChart = () => {
    if (data.length === 0) {
      return (
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500">
            No data available. Please upload files first.
          </p>
        </div>
      );
    }

    switch (type) {
      case "mrr-vs-plan":
        return <MRRChart data={data as ChartData[]} />;
      case "burn-rate":
        return <BurnRateChart data={data as ChartData[]} />;
      case "income-statement":
        return <WaterfallChart data={data as WaterfallData[]} height={300} />;
      case "variance-analysis":
        return <VarianceAnalysisChart data={data as ChartData[]} />;
      case "ytd-performance":
        return <YTDPerformanceChart data={data as ChartData[]} />;
      default:
        return null;
    }
  };

  return (
    <Card data-chart={type}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{CHART_TITLES[type]}</CardTitle>
          {showDatePicker &&
            onPeriodChange &&
            onCustomDateRangeChange &&
            customDateRange && (
              <DateRangePicker
                period={period}
                customDateRange={customDateRange}
                onPeriodChange={onPeriodChange}
                onCustomDateRangeChange={onCustomDateRangeChange}
              />
            )}
        </div>
      </CardHeader>
      <CardContent>{renderChart()}</CardContent>
    </Card>
  );
}
