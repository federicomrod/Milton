// components/dashboard/cash-flow/CashFlowSummaryCards.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Calendar } from "lucide-react";
import { formatCurrency } from "@/lib/utils/formatters";
import type { CashFlowMetrics } from "@/lib/cash-flow-data-generators";

interface CashFlowSummaryCardsProps {
  metrics: CashFlowMetrics;
  currency: string;
  numberFormat?: string;
}

export function CashFlowSummaryCards({
  metrics,
  currency,
  numberFormat,
}: CashFlowSummaryCardsProps) {
  const lastMonthNet =
    metrics.monthlyFlow.length > 0
      ? metrics.monthlyFlow[metrics.monthlyFlow.length - 1].netFlow
      : 0;

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <DollarSign className="h-4 w-4 mr-1" />
            Current Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${metrics.currentBalance >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {formatCurrency(metrics.currentBalance, currency, numberFormat)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <TrendingDown className="h-4 w-4 mr-1" />
            3-Month Avg Burn
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">
            {formatCurrency(
              Math.round(metrics.burnRate),
              currency,
              numberFormat
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Last 3 months average
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <Calendar className="h-4 w-4 mr-1" />
            Runway
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${metrics.runwayMonths > 12 ? "text-green-600" : metrics.runwayMonths > 6 ? "text-yellow-600" : "text-red-600"}`}
          >
            {metrics.runwayMonths > 100
              ? "∞"
              : `${metrics.runwayMonths} months`}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center">
            <TrendingUp className="h-4 w-4 mr-1" />
            Last Month Net
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${lastMonthNet >= 0 ? "text-green-600" : "text-red-600"}`}
          >
            {formatCurrency(Math.round(lastMonthNet), currency, numberFormat)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
