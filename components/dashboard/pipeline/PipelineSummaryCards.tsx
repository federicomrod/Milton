// components/dashboard/pipeline/PipelineSummaryCards.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency as formatCurrencyUtil } from "@/lib/utils/formatters";
import type { Deal } from "@/lib/types/pipeline";
import type { PipelineMetrics } from "@/lib/types/pipeline";

interface PipelineSummaryCardsProps {
  allDeals: Deal[];
  metrics: PipelineMetrics;
  currency: string;
}

export function PipelineSummaryCards({
  allDeals,
  metrics,
  currency,
}: PipelineSummaryCardsProps) {
  const totalPipelineValue = allDeals
    .filter((d) => d.stage !== "no_deal")
    .reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const activeDeals = allDeals.filter((d) => d.stage !== "no_deal").length;

  const closedWon = allDeals.filter(
    (d) => d.stage === "deal" && d.close_date
  ).length;
  const closedLost = allDeals.filter(
    (d) => d.stage === "no_deal" && d.close_date
  ).length;
  const total = closedWon + closedLost;
  const winRate = total === 0 ? "0.0" : ((closedWon / total) * 100).toFixed(1);

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Total Pipeline Value
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCurrencyUtil(totalPipelineValue, currency)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Active Deals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeDeals}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Avg. Sales Cycle
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {metrics.averageSalesCycle} days
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{winRate}%</div>
        </CardContent>
      </Card>
    </div>
  );
}
