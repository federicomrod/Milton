// components/dashboard/pipeline/TopDealsList.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhaseColors } from "@/lib/utils/pipeline-utils";
import { formatCurrency } from "@/lib/utils/pipeline-utils";
import type { FormatStyle } from "@/lib/utils/pipeline-utils";
import type { PipelineMetrics } from "@/lib/types/pipeline";

interface TopDealsListProps {
  topDeals: PipelineMetrics["topDeals"];
  colors: PhaseColors;
  currency: string;
  formatStyle: FormatStyle;
}

export function TopDealsList({
  topDeals,
  colors,
  currency,
  formatStyle,
}: TopDealsListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top 10 Deals</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {topDeals && topDeals.length > 0 ? (
            topDeals.map((deal, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-gray-50 rounded"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: colors[deal.phase] || "#ccc",
                    }}
                  ></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{deal.name}</p>
                    <p className="text-xs text-gray-500">{deal.client}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">
                    {formatCurrency(deal.amount, currency, formatStyle)}
                  </p>
                  <p className="text-xs text-gray-500">{deal.phase}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-64 text-gray-500">
              No deals found. Please verify CRM data.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
