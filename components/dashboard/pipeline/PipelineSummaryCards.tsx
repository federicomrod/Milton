// components/dashboard/pipeline/PipelineSummaryCards.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  formatCurrency as formatCurrencyUtil,
  formatPercentage,
} from "@/lib/utils/formatters";
import type { PipelineMetrics } from "@/lib/types/pipeline";
import {
  DollarSign,
  BarChart3,
  Users,
  PieChart,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

interface PipelineSummaryCardsProps {
  metrics: PipelineMetrics;
  totalRevenue: number;
  currency: string;
  numberFormat?: string;
}

export function PipelineSummaryCards({
  metrics,
  totalRevenue,
  currency,
  numberFormat,
}: PipelineSummaryCardsProps) {
  const arpa =
    metrics.activeCustomers > 0 ? totalRevenue / metrics.activeCustomers : 0;

  const cards: {
    title: string;
    value: string;
    description?: string;
    icon: LucideIcon;
    iconColor: string;
    valueColor: string;
  }[] = [
    {
      title: "Pipeline Value",
      value: formatCurrencyUtil(
        metrics.totalPipelineValue,
        currency,
        numberFormat
      ),
      icon: DollarSign,
      iconColor: "text-green-600",
      valueColor: "text-green-600",
    },
    {
      title: "Weighted Pipeline",
      value: formatCurrencyUtil(
        metrics.weightedPipelineValue,
        currency,
        numberFormat
      ),
      icon: BarChart3,
      iconColor: "text-blue-600",
      valueColor: "text-blue-600",
    },
    {
      title: "Active Customers",
      value: String(metrics.activeCustomers),
      icon: Users,
      iconColor: "text-violet-600",
      valueColor: "text-violet-600",
    },
    {
      title: "Revenue per Customer (ARPA)",
      value: arpa > 0 ? formatCurrencyUtil(arpa, currency, numberFormat) : "—",
      icon: DollarSign,
      iconColor: "text-amber-600",
      valueColor: "text-amber-600",
    },
    {
      title: "Client Concentration",
      value: formatPercentage(metrics.clientConcentrationPercent / 100),
      description: "Top client share of pipeline",
      icon: PieChart,
      iconColor: "text-rose-600",
      valueColor: "text-rose-600",
    },
    {
      title: "Deal Conversion Rate",
      value: `${metrics.dealConversionRate}%`,
      icon: TrendingUp,
      iconColor: "text-emerald-600",
      valueColor: "text-emerald-600",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.title} className="hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {card.title}
              </CardTitle>
              <Icon className={`h-4 w-4 ${card.iconColor}`} />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${card.valueColor}`}>
                {card.value}
              </div>
              {card.description && (
                <p className="text-xs text-muted-foreground mt-1">
                  {card.description}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
