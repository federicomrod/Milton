"use client";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatCurrency } from "@/lib/utils/formatters";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import type { ChartData } from "@/lib/chart-data-generators";

interface BurnRateChartProps {
  data: ChartData[];
}

export function BurnRateChart({ data }: BurnRateChartProps) {
  const { prefs } = useUserPreferences();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <defs>
          <linearGradient id="gradientRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="gradientExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0.1} />
          </linearGradient>
          <linearGradient id="gradientNetBurn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.8} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0.1} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
        <XAxis
          dataKey="month"
          tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
          axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
        />
        <YAxis
          tickFormatter={(value) => formatCurrency(value, prefs.currency)}
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
        />
        <Tooltip
          formatter={(value: any) =>
            formatCurrency(Number(value), prefs.currency)
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
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#10b981"
          fill="url(#gradientRevenue)"
          name="Revenue"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="expenses"
          stroke="#ef4444"
          fill="url(#gradientExpenses)"
          name="Expenses"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="netBurn"
          stroke="#6366f1"
          fill="url(#gradientNetBurn)"
          name="Net Burn"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
