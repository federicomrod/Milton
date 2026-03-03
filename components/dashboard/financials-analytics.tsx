"use client";

import { useState, useEffect } from "react";
import { FinancialCharts } from "@/components/dashboard/financial-charts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { useChartData } from "@/lib/hooks/useChartData";

interface FinancialsAnalyticsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function FinancialsAnalytics({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: FinancialsAnalyticsProps) {
  // Track loading state for all three charts
  const incomeStatement = useChartData(
    "income-statement",
    period,
    customDateRange
  );
  const varianceAnalysis = useChartData(
    "variance-analysis",
    period,
    customDateRange
  );
  const ytdPerformance = useChartData(
    "ytd-performance",
    period,
    customDateRange
  );

  const isLoading =
    incomeStatement.loading ||
    varianceAnalysis.loading ||
    ytdPerformance.loading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">
            Loading financials data...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-bold">Financials</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Revenue, expenses, and financial performance
          </p>
        </div>
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <FinancialCharts
          type="income-statement"
          period={period}
          customDateRange={customDateRange}
          data={incomeStatement.data}
        />
        <FinancialCharts
          type="variance-analysis"
          period={period}
          customDateRange={customDateRange}
          data={varianceAnalysis.data}
        />
      </div>
      <FinancialCharts
        type="ytd-performance"
        period={period}
        customDateRange={customDateRange}
        data={ytdPerformance.data}
      />
    </div>
  );
}
