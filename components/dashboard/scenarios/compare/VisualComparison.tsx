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

export interface CompareScenarioWithColor {
  id: string;
  name: string;
  color: string;
}

interface VisualComparisonProps {
  scenarios: CompareScenarioWithColor[];
  data: Record<string, number | string>[];
}

const KPI_OPTIONS = [
  { label: "Revenue", key: "revenue" },
  { label: "Cash", key: "cash" },
  { label: "Net Income", key: "netIncome" },
];

function formatChartValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    dataKey?: string;
    color?: string;
  }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-4 text-sm">
      <p className="font-medium text-foreground mb-2">{label}</p>
      <div className="space-y-1">
        {payload.map(
          (entry: {
            name?: string;
            value?: number;
            dataKey?: string;
            color?: string;
          }) => (
            <div
              key={String(entry.dataKey)}
              className="flex items-center gap-2"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              <span className="text-muted-foreground">{entry.name}:</span>
              <span>{formatChartValue(Number(entry.value))}</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function VisualComparison({ scenarios, data }: VisualComparisonProps) {
  const [selectedKPI, setSelectedKPI] = useState("revenue");

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold text-foreground">
          Trend Analysis
        </h3>
        <div className="flex gap-0.5 p-1 bg-muted rounded-lg w-fit">
          {KPI_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelectedKPI(option.key)}
              className={cn(
                "px-4 py-2 rounded-md text-sm font-medium transition-colors",
                selectedKPI === option.key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={320}>
        <LineChart
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
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
            tickFormatter={(v) => formatChartValue(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {scenarios.map((scenario) => (
            <Line
              key={scenario.id}
              type="monotone"
              dataKey={`${selectedKPI}_${scenario.id}`}
              name={scenario.name}
              stroke={scenario.color}
              strokeWidth={2}
              dot={{ r: 4 }}
              activeDot={{ r: 6 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}
