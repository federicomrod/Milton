// components/dashboard/cash-flow-analysis.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  Download,
  DollarSign,
  TrendingDown,
  Calendar,
  TrendingUp,
} from "lucide-react";
import { useCashFlowData } from "@/lib/hooks/useCashFlowData";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { CashBalanceChart } from "@/components/dashboard/cash-flow/CashBalanceChart";
import { MonthlyCashFlowChart } from "@/components/dashboard/cash-flow/MonthlyCashFlowChart";
import { NetCashFlowChart } from "@/components/dashboard/cash-flow/NetCashFlowChart";
import { CategoryBreakdownChart } from "@/components/dashboard/cash-flow/CategoryBreakdownChart";
import { CategoryNetImpact } from "@/components/dashboard/cash-flow/CategoryNetImpact";

interface CashFlowAnalysisProps {
  period?: "month" | "year" | "ytd" | "custom";
  customDateRange?: { from: string; to: string };
  onPeriodChange?: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange?: (range: { from: string; to: string }) => void;
}

export function CashFlowAnalysis({
  period: propPeriod,
  customDateRange: propCustomDateRange,
  onPeriodChange: propOnPeriodChange,
  onCustomDateRangeChange: propOnCustomDateRangeChange,
}: CashFlowAnalysisProps = {}) {
  const { prefs } = useUserPreferences();
  const [localPeriod, setLocalPeriod] = useState<
    "month" | "year" | "ytd" | "custom"
  >("month");
  const [localCustomDateRange, setLocalCustomDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  // Use props if provided, otherwise use local state
  const period = propPeriod ?? localPeriod;
  const customDateRange = propCustomDateRange ?? localCustomDateRange;
  const onPeriodChange = propOnPeriodChange ?? setLocalPeriod;
  const onCustomDateRangeChange =
    propOnCustomDateRangeChange ?? setLocalCustomDateRange;

  const { transactions, loading, metrics } = useCashFlowData(
    period,
    customDateRange
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">
            Loading cash flow data...
          </p>
        </div>
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="space-y-6" data-chart="cash-flow">
        {/* Header with filters */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Cash Flow Analysis</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Track your cash inflows, outflows, and balance over time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DateRangePicker
              period={period}
              customDateRange={customDateRange}
              onPeriodChange={onPeriodChange}
              onCustomDateRangeChange={onCustomDateRangeChange}
            />
            <Button variant="outline" size="sm" className="gap-2">
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </div>
        <Card>
          <CardContent>
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">
                No transaction data available for the selected period. Please
                upload your bank transactions or adjust the date range.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-chart="cash-flow">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Cash Flow Analysis</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track your cash inflows, outflows, and balance over time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker
            period={period}
            customDateRange={customDateRange}
            onPeriodChange={onPeriodChange}
            onCustomDateRangeChange={onCustomDateRangeChange}
          />
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          kpi={
            {
              id: "current-balance",
              name: "Current Balance",
              definition: "Current cash balance",
            } as DatabaseKpi
          }
          value={metrics.currentBalance}
          icon={DollarSign}
          iconColor={
            metrics.currentBalance >= 0 ? "text-green-600" : "text-red-600"
          }
          valueColor={
            metrics.currentBalance >= 0 ? "text-green-600" : "text-red-600"
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={
            {
              id: "burn-rate",
              name: "3-Month Avg Burn",
              definition: "Average monthly burn rate over last 3 months",
            } as DatabaseKpi
          }
          value={Math.round(metrics.burnRate)}
          icon={TrendingDown}
          iconColor="text-red-600"
          valueColor="text-red-600"
          description="Last 3 months average"
          fetchFromApi={false}
        />

        {metrics.runwayMonths > 100 ? (
          <Card className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Runway</CardTitle>
              <Calendar className="h-4 w-4 text-green-600" />
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <div className="text-2xl font-bold text-green-600">∞</div>
                <p className="text-xs text-muted-foreground">
                  Months of cash remaining at current burn rate
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <KpiCard
            kpi={
              {
                id: "runway",
                name: "Runway",
                definition: "Months of cash remaining at current burn rate",
              } as DatabaseKpi
            }
            value={metrics.runwayMonths}
            icon={Calendar}
            iconColor={
              metrics.runwayMonths > 12
                ? "text-green-600"
                : metrics.runwayMonths > 6
                  ? "text-yellow-600"
                  : "text-red-600"
            }
            valueColor={
              metrics.runwayMonths > 12
                ? "text-green-600"
                : metrics.runwayMonths > 6
                  ? "text-yellow-600"
                  : "text-red-600"
            }
            suffix=" months"
            fetchFromApi={false}
          />
        )}

        <KpiCard
          kpi={
            {
              id: "last-month-net",
              name: "Last Month Net",
              definition: "Net cash flow for the last month",
            } as DatabaseKpi
          }
          value={
            metrics.monthlyFlow.length > 0
              ? Math.round(
                  metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow
                )
              : 0
          }
          icon={TrendingUp}
          iconColor={
            metrics.monthlyFlow.length > 0 &&
            metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow >= 0
              ? "text-green-600"
              : "text-red-600"
          }
          valueColor={
            metrics.monthlyFlow.length > 0 &&
            metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow >= 0
              ? "text-green-600"
              : "text-red-600"
          }
          fetchFromApi={false}
        />
      </div>

      {/* Cash Balance Over Time */}
      <CashBalanceChart
        data={metrics.monthlyFlow}
        currency={prefs.currency}
        numberFormat={prefs.number_format}
      />

      {/* Monthly Cash Flow */}
      <MonthlyCashFlowChart
        data={metrics.monthlyFlow}
        currency={prefs.currency}
        numberFormat={prefs.number_format}
      />

      {/* Category Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <CategoryBreakdownChart
          data={metrics.categoryBreakdown}
          currency={prefs.currency}
          numberFormat={prefs.number_format}
        />
        <CategoryNetImpact
          data={metrics.categoryBreakdown}
          currency={prefs.currency}
        />
      </div>

      {/* Net Cash Flow Trend */}
      <NetCashFlowChart
        data={metrics.monthlyFlow}
        currency={prefs.currency}
        numberFormat={prefs.number_format}
      />
    </div>
  );
}
