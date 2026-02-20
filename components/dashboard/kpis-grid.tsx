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
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { KpiDisplayMode } from "@/components/dashboard/kpi-selector";

export interface KpiSeriesPoint {
  period: string;
  value: number;
}

interface KpisGridProps {
  selectedKpis: DatabaseKpi[];
  displayModes?: Record<string, KpiDisplayMode>;
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
  missingTableNames = [],
}: {
  kpi: DatabaseKpi;
  hasData: boolean;
  chartData: KpiSeriesPoint[];
  currency: string;
  numberFormat: string;
  hasRequiredData?: boolean;
  missingTableNames?: string[];
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
            : `Upload data for: ${missingTableNames.join(", ")}`}
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

export function KpisGrid({ selectedKpis, displayModes = {} }: KpisGridProps) {
  const { prefs } = useUserPreferences();
  const [seriesByKpi, setSeriesByKpi] = useState<
    Record<string, { data: KpiSeriesPoint[] }>
  >({});
  const [availableTableIds, setAvailableTableIds] = useState<Set<string>>(
    new Set()
  );
  const [tableNames, setTableNames] = useState<Record<string, string>>({});

  const kpiIdKey =
    selectedKpis.length > 0
      ? selectedKpis
          .map((k) => k.id)
          .slice()
          .sort()
          .join(",")
      : "";

  // Fetch KPI series data
  useEffect(() => {
    if (!kpiIdKey) {
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

  // Fetch available table IDs (fixing the tableIds key from the API)
  useEffect(() => {
    fetch("/api/model-data/tables", {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { tableIds: [] }))
      .then((json: { tableIds?: string[] }) => {
        setAvailableTableIds(new Set(json.tableIds ?? []));
      })
      .catch(() => setAvailableTableIds(new Set()));
  }, []);

  // Fetch human-readable names for all required_data table IDs
  useEffect(() => {
    const allIds = [
      ...new Set(selectedKpis.flatMap((kpi) => kpi.required_data ?? [])),
    ];
    if (allIds.length === 0) return;

    fetch(`/api/data/table-names?ids=${encodeURIComponent(allIds.join(","))}`, {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { names: {} }))
      .then((json: { names?: Record<string, string> }) =>
        setTableNames(json.names ?? {})
      )
      .catch(() => {});
  }, [kpiIdKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selectedKpis.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">
          No KPIs selected. Click &quot;Select KPIs&quot; to choose which KPIs
          you want to track.
        </p>
      </div>
    );
  }

  const resolveTableNames = (ids: string[]) =>
    ids.map((id) => tableNames[id] || id);

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
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {cardKpis.map((kpi) => {
            const requiredTables = kpi.required_data ?? [];
            const missingIds = requiredTables.filter(
              (id) => !availableTableIds.has(id)
            );
            const hasRequiredData = missingIds.length === 0;

            return (
              <KpiCard
                key={`card-${kpi.id}`}
                kpi={kpi}
                hasRequiredData={hasRequiredData}
                missingTables={resolveTableNames(missingIds)}
              />
            );
          })}
        </div>
      )}

      {/* Chart KPIs */}
      {chartKpis.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {chartKpis.map((kpi) => {
            const s = seriesByKpi[kpi.id];
            const chartData = s?.data ?? [];
            const hasData = chartData.length > 0;

            const requiredTables = kpi.required_data ?? [];
            const missingIds = requiredTables.filter(
              (id) => !availableTableIds.has(id)
            );
            const hasRequiredData = missingIds.length === 0;

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
                    hasData={hasData}
                    chartData={chartData}
                    currency={prefs.currency}
                    numberFormat={prefs.number_format}
                    hasRequiredData={hasRequiredData}
                    missingTableNames={resolveTableNames(missingIds)}
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
