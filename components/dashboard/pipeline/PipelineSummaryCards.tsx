// components/dashboard/pipeline/PipelineSummaryCards.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency as formatCurrencyUtil } from "@/lib/utils/formatters";
import { normalizeStage } from "@/lib/utils/pipeline-utils";
import type { Deal } from "@/lib/types/pipeline";
import type { PipelineMetrics } from "@/lib/types/pipeline";

interface PipelineSummaryCardsProps {
  allDeals: Deal[];
  metrics: PipelineMetrics;
  currency: string;
  numberFormat?: string;
}

export function PipelineSummaryCards({
  allDeals,
  metrics,
  currency,
  numberFormat,
}: PipelineSummaryCardsProps) {
  // Pipeline value should only include ACTIVE deals (exclude closed won and closed lost)
  const totalPipelineValue = allDeals
    .filter((d) => {
      const normalizedStage = normalizeStage(d.stage || "");
      // Only include active pipeline stages, exclude closed deals
      return normalizedStage !== "No Deal" && normalizedStage !== "Deal";
    })
    .reduce((sum, d) => sum + Number(d.amount || 0), 0);

  const activeDeals = allDeals.filter((d) => {
    const normalizedStage = normalizeStage(d.stage || "");
    // Only count active deals, exclude closed deals
    return normalizedStage !== "No Deal" && normalizedStage !== "Deal";
  }).length;

  const closedWon = allDeals.filter((d) => {
    const normalizedStage = normalizeStage(d.stage || "");
    return normalizedStage === "Deal" && d.close_date;
  }).length;

  const closedLost = allDeals.filter((d) => {
    const normalizedStage = normalizeStage(d.stage || "");
    return normalizedStage === "No Deal" && d.close_date;
  }).length;

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
            {formatCurrencyUtil(totalPipelineValue, currency, numberFormat)}
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
