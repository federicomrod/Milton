"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, TrendingUp } from "lucide-react";
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

export interface KpiSeriesPoint {
  period: string;
  value: number;
}

interface KpisGridProps {
  selectedKpis: DatabaseKpi[];
}

type KpiFormat = "number" | "currency" | "percentage";

// Dynamic KPI display format based on KPI name
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
  } else if (
    name?.includes("count") ||
    name?.includes("number") ||
    name?.includes("members") ||
    name?.includes("classes") ||
    name?.includes("size") ||
    name?.includes("tenure") ||
    name?.includes("runway")
  ) {
    return "number";
  }

  return "number"; // default
};

const PLACEHOLDER_DATA: KpiSeriesPoint[] = Array.from(
  { length: 6 },
  (_, i) => ({
    period: `Period ${i + 1}`,
    value: 0,
  })
);

const KpiChart = ({
  kpi,
  hasData,
  chartData,
  currency,
  numberFormat,
  hasRequiredData = true,
  missingTables = [],
}: {
  kpi: DatabaseKpi;
  hasData: boolean;
  chartData: KpiSeriesPoint[];
  currency: string;
  numberFormat: string;
  hasRequiredData?: boolean;
  missingTables?: string[];
}) => {
  const data = hasData && chartData.length > 0 ? chartData : PLACEHOLDER_DATA;
  const display = { format: getKpiDisplayFormat(kpi.name) };
  const maxValue = data.reduce((max, d) => Math.max(max, d.value), 0);
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

  if (!hasData) {
    return (
      <div className="h-64 flex flex-col items-center justify-center bg-muted/30 rounded-lg border border-dashed border-muted-foreground/20">
        <TrendingUp className="h-12 w-12 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground text-center px-4">
          {hasRequiredData
            ? "Data not available yet"
            : "Required data tables missing"}
        </p>
        <p className="text-xs text-muted-foreground/60 text-center mt-1 px-4">
          {hasRequiredData
            ? "Required data collection is in development"
            : `Upload data for: ${missingTables.join(", ")}`}
        </p>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={256}>
      <LineChart data={data}>
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

export function KpisGrid({ selectedKpis }: KpisGridProps) {
  const { prefs } = useUserPreferences();
  const [seriesByKpi, setSeriesByKpi] = useState<
    Record<string, { data: KpiSeriesPoint[] }>
  >({});
  const [availableTables, setAvailableTables] = useState<Set<string>>(
    new Set()
  );

  const kpiIdKey =
    selectedKpis.length > 0
      ? selectedKpis
          .map((k) => k.id)
          .slice()
          .sort()
          .join(",")
      : "";

  useEffect(() => {
    if (!kpiIdKey) {
      // Use setTimeout to avoid synchronous setState in effect
      setTimeout(() => setSeriesByKpi({}), 0);
      return;
    }
    fetch(`/api/kpis/series?kpiIds=${encodeURIComponent(kpiIdKey)}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { series: {} }))
      .then((json: { series?: Record<string, { data: KpiSeriesPoint[] }> }) =>
        setSeriesByKpi(json.series ?? {})
      )
      .catch(() => setSeriesByKpi({}));
  }, [kpiIdKey]);

  // Fetch available tables
  useEffect(() => {
    fetch("/api/model-data/tables", {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { tables: [] }))
      .then((json: { tables?: string[] }) => {
        setAvailableTables(new Set(json.tables ?? []));
      })
      .catch(() => setAvailableTables(new Set()));
  }, []);

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

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {selectedKpis.map((kpi) => {
        const s = seriesByKpi[kpi.id];
        const chartData = s?.data ?? [];
        const hasData = chartData.length > 0;

        // Check if required data tables are available
        const requiredTables = kpi.required_data || [];
        const missingTables = requiredTables.filter(
          (table) => !availableTables.has(table)
        );
        const hasRequiredData = missingTables.length === 0;

        return (
          <Card key={kpi.id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">
                {kpi.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {kpi.definition}
              </p>
            </CardHeader>
            <CardContent>
              <div>
                <KpiChart
                  kpi={kpi}
                  hasData={hasData}
                  chartData={chartData}
                  currency={prefs.currency}
                  numberFormat={prefs.number_format}
                  hasRequiredData={hasRequiredData}
                  missingTables={missingTables}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
