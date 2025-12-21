"use client";
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
import { formatCurrency } from "@/lib/utils/formatters";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import type { ChartData } from "@/lib/chart-data-generators";

interface YTDPerformanceChartProps {
  data: ChartData[];
}

export function YTDPerformanceChart({ data }: YTDPerformanceChartProps) {
  const { prefs } = useUserPreferences();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
        <XAxis
          dataKey="month"
          tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
          axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
        />
        <YAxis
          tickFormatter={(value) =>
            formatCurrency(value, prefs.currency, prefs.number_format)
          }
          tick={{ fill: "#6b7280", fontSize: 11 }}
          axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
        />
        <Tooltip
          formatter={(value: any) =>
            formatCurrency(Number(value), prefs.currency, prefs.number_format)
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
        <Line
          type="monotone"
          dataKey="cumActual"
          stroke="#3b82f6"
          name="YTD Actual"
          strokeWidth={3}
          dot={{ fill: "#3b82f6", r: 4 }}
          activeDot={{ r: 6 }}
        />
        <Line
          type="monotone"
          dataKey="cumBudget"
          stroke="#94a3b8"
          name="YTD Budget"
          strokeWidth={3}
          strokeDasharray="5 5"
          dot={{ fill: "#94a3b8", r: 4 }}
          activeDot={{ r: 6 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
