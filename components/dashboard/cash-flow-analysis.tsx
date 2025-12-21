// components/dashboard/cash-flow-analysis.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCashFlowData } from "@/lib/hooks/useCashFlowData";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { CashFlowSummaryCards } from "@/components/dashboard/cash-flow/CashFlowSummaryCards";
import { CashBalanceChart } from "@/components/dashboard/cash-flow/CashBalanceChart";
import { MonthlyCashFlowChart } from "@/components/dashboard/cash-flow/MonthlyCashFlowChart";
import { NetCashFlowChart } from "@/components/dashboard/cash-flow/NetCashFlowChart";
import { CategoryBreakdownChart } from "@/components/dashboard/cash-flow/CategoryBreakdownChart";
import { CategoryNetImpact } from "@/components/dashboard/cash-flow/CategoryNetImpact";

export function CashFlowAnalysis() {
  const { prefs } = useUserPreferences();
  const { transactions, loading, metrics } = useCashFlowData();

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash Flow Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading cash flow data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (transactions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cash Flow Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">
              No transaction data available. Please upload your bank
              transactions.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-chart="cash-flow">
      {/* Summary Cards */}
      <CashFlowSummaryCards
        metrics={metrics}
        currency={prefs.currency}
        numberFormat={prefs.number_format}
      />

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
