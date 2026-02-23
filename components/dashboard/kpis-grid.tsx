"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/utils/formatters";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { KpiDisplayMode } from "@/components/dashboard/kpi-selector";

interface KpisGridProps {
  selectedKpis: DatabaseKpi[];
  displayModes?: Record<string, KpiDisplayMode>;
  analyticsKpiData?: Record<string, number | null>;
}

type KpiFormat = "number" | "currency" | "percentage";

const getKpiDisplayFormat = (kpiName: string): KpiFormat => {
  const name = kpiName?.toLowerCase().trim();

  if (
    name?.includes("rate") ||
    name?.includes("percentage") ||
    name?.includes("utilization") ||
    name?.includes("no show") ||
    name?.includes("no-show") ||
    name?.includes("churn") ||
    name?.includes("attendance") ||
    name?.includes("occupancy") ||
    name?.includes("cancellation")
  ) {
    return "percentage";
  } else if (
    name?.includes("revenue") ||
    name?.includes("income") ||
    name?.includes("burn") ||
    name?.includes("cost") ||
    name?.includes("expense") ||
    name?.includes("profit")
  ) {
    return "currency";
  }

  return "number";
};

// Placeholder data for charts when analytics doesn't provide series
const PLACEHOLDER_DATA = Array.from({ length: 6 }, (_, i) => ({
  period: `Period ${i + 1}`,
  value: 0,
}));

const KpiChart = ({
  kpi,
  analyticsValue,
  currency,
  numberFormat,
}: {
  kpi: DatabaseKpi;
  analyticsValue: number | null;
  currency: string;
  numberFormat: string;
}) => {
  const display = { format: getKpiDisplayFormat(kpi.name) };
  const maxValue = Math.max(Math.abs(analyticsValue || 0), 1);
  const percentageBasis = maxValue > 1.5 ? 100 : 1;

  const formatValue = (value: number) => {
    if (display.format === "currency") {
      return formatCurrency(value, currency, numberFormat);
    }
    if (display.format === "percentage") {
      return formatPercentage(value / percentageBasis);
    }
    return formatNumber(value, numberFormat);
  };

  // Create a simple chart with current value vs placeholder
  const chartData = [
    { period: "Current", value: analyticsValue || 0 },
    ...PLACEHOLDER_DATA.slice(1),
  ];

  return (
    <ResponsiveContainer width="100%" height={256}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis
          dataKey="period"
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
        />
        <YAxis
          stroke="#6b7280"
          fontSize={12}
          tickLine={false}
          domain={
            display.format === "percentage"
              ? [0, percentageBasis]
              : ["auto", "auto"]
          }
          tickFormatter={(value) => formatValue(Number(value))}
        />
        <Tooltip
          formatter={(value) => formatValue(Number(value))}
          contentStyle={{
            backgroundColor: "white",
            border: "1px solid #e5e7eb",
            borderRadius: "6px",
          }}
        />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={{ fill: "#3b82f6", r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
};

export function KpisGrid({
  selectedKpis,
  displayModes = {},
  analyticsKpiData = {},
}: KpisGridProps) {
  const { prefs } = useUserPreferences();

  if (selectedKpis.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          No KPIs selected. Click "Select KPIs" to choose which KPIs you want to
          track.
        </p>
      </div>
    );
  }

  // Separate KPIs into card and chart groups based on display modes
  const cardKpis = selectedKpis.filter((kpi) => {
    const modes = displayModes[kpi.id] ?? ["card"];
    return modes.includes("card");
  });

  const chartKpis = selectedKpis.filter((kpi) => {
    const modes = displayModes[kpi.id] ?? ["card"];
    return modes.includes("chart");
  });

  return (
    <div className="space-y-6">
      {/* Card KPIs */}
      {cardKpis.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {cardKpis.map((kpi) => {
            const analyticsValue = analyticsKpiData[kpi.id];

            return (
              <KpiCard
                key={`card-${kpi.id}`}
                kpi={kpi}
                value={analyticsValue ?? null}
                hasRequiredData={true}
                missingTables={[]}
                fetchFromApi={false}
              />
            );
          })}
        </div>
      )}

      {/* Chart KPIs */}
      {chartKpis.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {chartKpis.map((kpi) => {
            const analyticsValue = analyticsKpiData[kpi.id];

            return (
              <Card
                key={`chart-${kpi.id}`}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-base font-semibold">
                    {kpi.name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {kpi.definition}
                  </p>
                </CardHeader>
                <CardContent>
                  <KpiChart
                    kpi={kpi}
                    analyticsValue={analyticsValue}
                    currency={prefs.currency}
                    numberFormat={prefs.number_format}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
