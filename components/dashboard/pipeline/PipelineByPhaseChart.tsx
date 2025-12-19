// components/dashboard/pipeline/PipelineByPhaseChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { PhaseColors } from "@/lib/utils/pipeline-utils";
import { formatCurrency } from "@/lib/utils/pipeline-utils";
import type { FormatStyle } from "@/lib/utils/pipeline-utils";
import { useMemo } from "react";

interface PhaseData {
  phase: string;
  count: number;
  value: number;
  avgValue: number;
}

interface PipelineByPhaseChartProps {
  data: PhaseData[];
  colors: PhaseColors;
  currency: string;
  formatStyle: FormatStyle;
  title: string;
  dataKey: "value" | "count";
}

// Helper to create gradient ID from phase name
const getGradientId = (phase: string) =>
  `gradient-${phase.replace(/\s+/g, "-").toLowerCase()}`;

export function PipelineByPhaseChart({
  data,
  colors,
  currency,
  formatStyle,
  title,
  dataKey,
}: PipelineByPhaseChartProps) {
  // Generate gradient definitions for each phase
  const gradients = useMemo(() => {
    return data.map((entry) => {
      const color = colors[entry.phase];
      const gradientId = getGradientId(entry.phase);
      return { phase: entry.phase, color, gradientId };
    });
  }, [data, colors]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
          >
            <defs>
              {gradients.map(({ gradientId, color }) => (
                <linearGradient
                  key={gradientId}
                  id={gradientId}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="5%" stopColor={color} stopOpacity={0.9} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.4} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              opacity={0.4}
            />
            <XAxis
              dataKey="phase"
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <YAxis
              tickFormatter={
                dataKey === "value"
                  ? (value) => formatCurrency(value, currency, formatStyle)
                  : undefined
              }
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <Tooltip
              formatter={
                dataKey === "value"
                  ? (value: number | string) =>
                      formatCurrency(Number(value), currency, formatStyle)
                  : (value: number | string) => value
              }
              contentStyle={{
                backgroundColor: "white",
                border: "1px solid #e5e7eb",
                borderRadius: "8px",
                boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                padding: "12px",
              }}
              labelStyle={{
                color: "#111827",
                fontWeight: 600,
                marginBottom: "4px",
              }}
            />
            <Bar
              dataKey={dataKey}
              name={dataKey === "value" ? "Total Value" : "Number of Deals"}
              radius={[8, 8, 0, 0]}
            >
              {data.map((entry, index) => {
                const gradientId = getGradientId(entry.phase);
                return (
                  <Cell key={`cell-${index}`} fill={`url(#${gradientId})`} />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
