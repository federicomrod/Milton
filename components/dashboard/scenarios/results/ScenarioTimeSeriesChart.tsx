"use client";

import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ScenarioChartMetric = "revenue" | "costs" | "cash";

interface ScenarioTimeSeriesChartProps {
  selectedMetric?: ScenarioChartMetric;
  onMetricChange?: (metric: ScenarioChartMetric) => void;
}

interface DataPoint {
  month: string;
  baseline: number;
  scenario: number;
}

const revenueData: DataPoint[] = [
  { month: "Jan", baseline: 500, scenario: 520 },
  { month: "Feb", baseline: 520, scenario: 580 },
  { month: "Mar", baseline: 510, scenario: 620 },
  { month: "Apr", baseline: 530, scenario: 680 },
  { month: "May", baseline: 550, scenario: 720 },
  { month: "Jun", baseline: 570, scenario: 780 },
  { month: "Jul", baseline: 590, scenario: 840 },
  { month: "Aug", baseline: 600, scenario: 880 },
  { month: "Sep", baseline: 610, scenario: 920 },
  { month: "Oct", baseline: 620, scenario: 960 },
  { month: "Nov", baseline: 630, scenario: 1000 },
  { month: "Dec", baseline: 640, scenario: 1050 },
];

const costsData: DataPoint[] = [
  { month: "Jan", baseline: 280, scenario: 300 },
  { month: "Feb", baseline: 290, scenario: 320 },
  { month: "Mar", baseline: 285, scenario: 340 },
  { month: "Apr", baseline: 300, scenario: 360 },
  { month: "May", baseline: 310, scenario: 380 },
  { month: "Jun", baseline: 320, scenario: 400 },
  { month: "Jul", baseline: 330, scenario: 420 },
  { month: "Aug", baseline: 335, scenario: 435 },
  { month: "Sep", baseline: 340, scenario: 450 },
  { month: "Oct", baseline: 345, scenario: 465 },
  { month: "Nov", baseline: 350, scenario: 475 },
  { month: "Dec", baseline: 360, scenario: 480 },
];

const cashData: DataPoint[] = [
  { month: "Jan", baseline: 1200, scenario: 1220 },
  { month: "Feb", baseline: 1430, scenario: 1480 },
  { month: "Mar", baseline: 1655, scenario: 1760 },
  { month: "Apr", baseline: 1885, scenario: 2080 },
  { month: "May", baseline: 2125, scenario: 2420 },
  { month: "Jun", baseline: 2375, scenario: 2800 },
  { month: "Jul", baseline: 2635, scenario: 3220 },
  { month: "Aug", baseline: 2900, scenario: 3665 },
  { month: "Sep", baseline: 3170, scenario: 4135 },
  { month: "Oct", baseline: 3445, scenario: 4630 },
  { month: "Nov", baseline: 3725, scenario: 5155 },
  { month: "Dec", baseline: 4005, scenario: 5725 },
];

const chartConfig: Record<
  ScenarioChartMetric,
  { data: DataPoint[]; label: string; unit: string }
> = {
  revenue: { data: revenueData, label: "Revenue", unit: "$" },
  costs: { data: costsData, label: "Costs", unit: "$" },
  cash: { data: cashData, label: "Cash Balance", unit: "$" },
};

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  unit: string;
}

function CustomTooltip({ active, payload, label, unit }: CustomTooltipProps) {
  if (!active || !payload?.length || payload.length < 2) return null;

  const baseline = payload[0].value ?? 0;
  const scenario = payload[1].value ?? 0;
  const delta = scenario - baseline;
  const deltaPercent =
    baseline !== 0 ? ((delta / baseline) * 100).toFixed(1) : "0";

  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-4 text-sm">
      <p className="font-medium text-foreground mb-2">{label}</p>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-muted-foreground" />
          <span className="text-muted-foreground">Baseline:</span>
          <span>
            {unit}
            {baseline}K
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary" />
          <span className="text-muted-foreground">Scenario:</span>
          <span>
            {unit}
            {scenario}K
          </span>
        </div>
        <div className="pt-2 mt-2 border-t border-border">
          <span className="text-muted-foreground">Delta: </span>
          <span
            className={
              delta >= 0
                ? "text-emerald-600 font-medium"
                : "text-destructive font-medium"
            }
          >
            {delta >= 0 ? "+" : ""}
            {unit}
            {delta}K ({deltaPercent}%)
          </span>
        </div>
      </div>
    </div>
  );
}

const metrics: { value: ScenarioChartMetric; label: string }[] = [
  { value: "revenue", label: "Revenue" },
  { value: "costs", label: "Costs" },
  { value: "cash", label: "Cash Balance" },
];

export function ScenarioTimeSeriesChart({
  selectedMetric: controlledMetric,
  onMetricChange,
}: ScenarioTimeSeriesChartProps) {
  const [internalMetric, setInternalMetric] =
    useState<ScenarioChartMetric>("revenue");
  const selectedMetric = controlledMetric ?? internalMetric;
  const setMetric = onMetricChange ?? setInternalMetric;

  const config = chartConfig[selectedMetric];

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 className="text-lg font-semibold text-foreground">
          Projection Over Time
        </h2>

        <div className="flex gap-0.5 p-1 bg-muted rounded-lg w-fit">
          {metrics.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMetric(m.value)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                selectedMetric === m.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart
          data={config.data}
          margin={{ top: 10, right: 20, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
          <XAxis
            dataKey="month"
            tick={{ fill: "#737373", fontSize: 12 }}
            axisLine={{ stroke: "#d4d4d4" }}
          />
          <YAxis
            tick={{ fill: "#737373", fontSize: 12 }}
            axisLine={{ stroke: "#d4d4d4" }}
            tickFormatter={(v) => `${config.unit}${v}K`}
          />
          <Tooltip content={<CustomTooltip unit={config.unit} />} />
          <Legend
            wrapperStyle={{ paddingTop: "20px" }}
            formatter={(value) =>
              value === "baseline" ? "Baseline" : "Current Scenario"
            }
          />
          <Line
            type="monotone"
            dataKey="baseline"
            name="baseline"
            stroke="#a3a3a3"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="scenario"
            name="scenario"
            stroke="#2563eb"
            strokeWidth={3}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
