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

export interface KpiSeriesPoint {
  period: string;
  value: number;
}

interface KpisGridProps {
  selectedKpis: DatabaseKpi[];
}

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
}: {
  kpi: DatabaseKpi;
  hasData: boolean;
  chartData: KpiSeriesPoint[];
}) => {
  const data = hasData && chartData.length > 0 ? chartData : PLACEHOLDER_DATA;

  if (!hasData) {
    return (
      <div className="h-64 flex flex-col items-center justify-center bg-muted/30 rounded-lg border border-dashed border-muted-foreground/20">
        <TrendingUp className="h-12 w-12 text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground text-center px-4">
          Data not available yet
        </p>
        <p className="text-xs text-muted-foreground/60 text-center mt-1 px-4">
          Required data collection is in development
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
        <YAxis stroke="#6b7280" fontSize={12} tickLine={false} />
        <Tooltip
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
  const [seriesByKpi, setSeriesByKpi] = useState<
    Record<string, { data: KpiSeriesPoint[] }>
  >({});

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
                <KpiChart kpi={kpi} hasData={hasData} chartData={chartData} />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
