// components/dashboard/cash-flow/NetCashFlowChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils/formatters";
import type { MonthlyFlowData } from "@/lib/cash-flow-data-generators";

interface NetCashFlowChartProps {
  data: MonthlyFlowData[];
  currency: string;
}

export function NetCashFlowChart({ data, currency }: NetCashFlowChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Net Cash Flow Trend</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              opacity={0.4}
            />
            <XAxis
              dataKey="month"
              tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <YAxis
              tickFormatter={(value) => formatCurrency(value, currency)}
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <Tooltip
              formatter={(value: number | string) =>
                formatCurrency(Number(value), currency)
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
            <Line
              type="monotone"
              dataKey="netFlow"
              stroke="#6366f1"
              strokeWidth={2}
              dot={{ fill: "#6366f1", r: 4 }}
              activeDot={{ r: 6 }}
            />
            <Line
              y={0}
              stroke="#9ca3af"
              strokeWidth={1}
              strokeDasharray="3 3"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
