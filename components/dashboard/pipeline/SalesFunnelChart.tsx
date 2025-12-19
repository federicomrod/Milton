// components/dashboard/pipeline/SalesFunnelChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PhaseColors } from "@/lib/utils/pipeline-utils";
import { formatCurrency } from "@/lib/utils/pipeline-utils";
import type { FormatStyle } from "@/lib/utils/pipeline-utils";

interface FunnelData {
  phase: string;
  count: number;
  cumulativeCount: number;
  value: number;
  percentage: string;
  avgDealSize: number;
}

interface SalesFunnelChartProps {
  funnelData: FunnelData[];
  colors: PhaseColors;
  currency: string;
  formatStyle: FormatStyle;
}

export function SalesFunnelChart({
  funnelData,
  colors,
  currency,
  formatStyle,
}: SalesFunnelChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales Funnel</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {funnelData.map((stage, index) => {
            const width = `${stage.percentage}%`;
            const isLast = index === funnelData.length - 1;

            return (
              <div key={stage.phase} className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{stage.phase}</span>
                  <span className="text-sm text-gray-600">
                    {stage.cumulativeCount} deals ({stage.percentage}%) –{" "}
                    {formatCurrency(stage.value, currency, formatStyle)}
                  </span>
                </div>
                <div className="relative h-12 bg-gray-100 rounded-lg overflow-hidden shadow-sm">
                  <div
                    className="absolute inset-y-0 left-0 flex items-center justify-center text-white font-semibold transition-all duration-500 rounded-lg"
                    style={{
                      width: width,
                      background: `linear-gradient(135deg, ${colors[stage.phase]} 0%, ${colors[stage.phase]}dd 100%)`,
                      boxShadow: "inset 0 2px 4px rgba(0, 0, 0, 0.1)",
                    }}
                  />
                </div>
                {!isLast && (
                  <div className="flex justify-center my-2">
                    <svg
                      className="w-6 h-6 text-gray-400"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
