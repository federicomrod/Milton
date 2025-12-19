// components/dashboard/cash-flow/MonthlyCashFlowChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils/formatters";
import type { MonthlyFlowData } from "@/lib/cash-flow-data-generators";

interface MonthlyCashFlowChartProps {
  data: MonthlyFlowData[];
  currency: string;
}

export function MonthlyCashFlowChart({
  data,
  currency,
}: MonthlyCashFlowChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly Cash Flow</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <defs>
              <linearGradient id="gradientInflow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.9} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0.4} />
              </linearGradient>
              <linearGradient id="gradientOutflow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.9} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0.4} />
              </linearGradient>
            </defs>
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
            <Legend
              wrapperStyle={{ paddingTop: "24px" }}
              iconType="circle"
              iconSize={10}
            />
            <Bar
              dataKey="inflow"
              fill="url(#gradientInflow)"
              name="Inflow"
              radius={[8, 8, 0, 0]}
            />
            <Bar
              dataKey="outflow"
              fill="url(#gradientOutflow)"
              name="Outflow"
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
