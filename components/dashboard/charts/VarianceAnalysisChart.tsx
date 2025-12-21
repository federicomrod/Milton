"use client";
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
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import type { ChartData } from "@/lib/chart-data-generators";

interface VarianceAnalysisChartProps {
  data: ChartData[];
}

export function VarianceAnalysisChart({ data }: VarianceAnalysisChartProps) {
  const { prefs } = useUserPreferences();

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart
        data={data}
        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
      >
        <defs>
          <linearGradient id="gradientBudget" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#94a3b8" stopOpacity={0.9} />
            <stop offset="95%" stopColor="#94a3b8" stopOpacity={0.4} />
          </linearGradient>
          <linearGradient id="gradientActual" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.9} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.4} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" opacity={0.4} />
        <XAxis
          dataKey="metric"
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
          formatter={(value: number) =>
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
        <Bar
          dataKey="budget"
          fill="url(#gradientBudget)"
          name="Budget"
          radius={[8, 8, 0, 0]}
        />
        <Bar
          dataKey="actual"
          fill="url(#gradientActual)"
          name="Actual"
          radius={[8, 8, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
