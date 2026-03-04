"use client";

import { useState, useEffect, startTransition } from "react";
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
  period?: string;
  customDateRange?: { from: string; to: string };
}

type KpiFormat = "number" | "currency" | "percentage";

type SeriesPoint = { period: string; value: number };

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
    // Special case: burn rate should be currency, not percentage
    if (name?.includes("burn rate")) {
      return "currency";
    }
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

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Handles "YYYY-MM", "YYYY-MM-01", "YYYY-MM-DD" — all map to "Mon 'YY"
const formatPeriodLabel = (period: string): string => {
  const match = period.match(/^(\d{4})-(\d{2})/);
  if (match) {
    const [, year, month] = match;
    return `${MONTH_ABBR[Number(month) - 1]} '${year.slice(2)}`;
  }
  return period;
};

/** Returns every "YYYY-MM" month string from `from` to `to` (inclusive). */
function getAllMonthsInRange(from: string, to: string): string[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const months: string[] = [];
  for (
    let d = new Date(fromYear, fromMonth - 1, 1);
    d <= new Date(toYear, toMonth - 1, 1);
    d.setMonth(d.getMonth() + 1)
  ) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
  }
  return months;
}

/**
 * Ensures every month in the range has a data point.
 * Missing months are filled with 0. Handles "YYYY-MM", "YYYY-MM-01", "YYYY-MM-DD"
 * period formats by normalising to "YYYY-MM" before merging.
 */
function fillMonthGaps(
  data: SeriesPoint[],
  from: string,
  to: string
): SeriesPoint[] {
  const allMonths = getAllMonthsInRange(from, to);
  const byMonth = new Map(data.map((p) => [p.period.substring(0, 7), p.value]));
  return allMonths.map((month) => ({
    period: month,
    value: byMonth.get(month) ?? 0,
  }));
}

/** Converts a period preset + optional custom range into concrete from/to date strings. */
function resolveDateRange(
  period: string | undefined,
  customDateRange: { from: string; to: string } | undefined
): { from: string; to: string } {
  const today = new Date().toISOString().split("T")[0];

  if (period === "custom" || !period) {
    return (
      customDateRange ?? {
        from: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0],
        to: today,
      }
    );
  }
  if (period === "ytd") {
    return { from: `${new Date().getFullYear()}-01-01`, to: today };
  }
  if (period === "year") {
    const y = new Date().getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  // "month" — last 6 months for broader coverage
  return {
    from: new Date(new Date().setMonth(new Date().getMonth() - 6))
      .toISOString()
      .split("T")[0],
    to: today,
  };
}

const KpiChart = ({
  kpi,
  analyticsValue,
  seriesData,
  resolvedFrom,
  resolvedTo,
  currency,
  numberFormat,
}: {
  kpi: DatabaseKpi;
  analyticsValue: number | null;
  seriesData?: SeriesPoint[];
  resolvedFrom: string;
  resolvedTo: string;
  currency: string;
  numberFormat: string;
}) => {
  const display = { format: getKpiDisplayFormat(kpi.name) };
  // Percentage KPIs (churn, cancellation, utilization, etc.) always use 0-100 scale
  const percentageBasis = display.format === "percentage" ? 100 : 1;
  const maxValue =
    display.format === "percentage"
      ? 100
      : Math.max(Math.abs(analyticsValue || 0), 1);

  const formatValue = (value: number) => {
    if (display.format === "currency") {
      return formatCurrency(value, currency, numberFormat);
    }
    if (display.format === "percentage") {
      // Safeguard: if value > 100, treat as double-scaled (e.g. 1800 instead of 18).
      const normalized = value > 100 ? value / 100 : value;
      return formatPercentage(normalized / percentageBasis);
    }
    return formatNumber(value, numberFormat);
  };

  // Use filled series data if available; otherwise build a zero-filled skeleton
  // for every month in the range so the chart always shows a full timeline.
  const filledData: SeriesPoint[] =
    seriesData && seriesData.length > 0
      ? seriesData
      : fillMonthGaps([], resolvedFrom, resolvedTo);

  const chartData = filledData.map((p) => ({
    period: formatPeriodLabel(p.period),
    value: p.value,
  }));

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
  period,
  customDateRange,
}: KpisGridProps) {
  const { prefs } = useUserPreferences();
  const [seriesData, setSeriesData] = useState<Record<string, SeriesPoint[]>>(
    {}
  );

  const chartKpis = selectedKpis.filter((kpi) => {
    const modes = displayModes[kpi.id] ?? ["card"];
    return modes.includes("chart");
  });
  const chartKpiIdsStr = chartKpis.map((k) => k.id).join(",");

  // Resolve the actual date range from both period preset and custom range
  const { from: resolvedFrom, to: resolvedTo } = resolveDateRange(
    period,
    customDateRange
  );
  const dateParams = `&from_date=${resolvedFrom}&to_date=${resolvedTo}`;

  useEffect(() => {
    if (!chartKpiIdsStr) {
      startTransition(() => setSeriesData({}));
      return;
    }
    fetch(`/api/kpis/series?kpiIds=${chartKpiIdsStr}${dateParams}`)
      .then((r) => r.json())
      .then((data) => {
        const mapped: Record<string, SeriesPoint[]> = {};
        for (const [id, val] of Object.entries(data.series || {})) {
          const raw = (val as { data: SeriesPoint[] }).data;
          // Fill every month in the selected range so the X-axis is always complete
          mapped[id] = fillMonthGaps(raw, resolvedFrom, resolvedTo);
        }
        setSeriesData(mapped);
      })
      .catch(() => {});
  }, [chartKpiIdsStr, dateParams]);

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

  const cardKpis = selectedKpis.filter((kpi) => {
    const modes = displayModes[kpi.id] ?? ["card"];
    return modes.includes("card");
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
                    seriesData={seriesData[kpi.id]}
                    resolvedFrom={resolvedFrom}
                    resolvedTo={resolvedTo}
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
