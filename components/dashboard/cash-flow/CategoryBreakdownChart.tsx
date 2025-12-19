// components/dashboard/cash-flow/CategoryBreakdownChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/utils/formatters";
import type { CategoryBreakdown } from "@/lib/cash-flow-data-generators";

interface CategoryBreakdownChartProps {
  data: CategoryBreakdown[];
  currency: string;
}

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export function CategoryBreakdownChart({
  data,
  currency,
}: CategoryBreakdownChartProps) {
  const filteredData = data.filter((c) => c.outflow > 0);

  const getCurrencySymbol = () => {
    return currency === "EUR"
      ? "€"
      : currency === "USD"
        ? "$"
        : currency === "GBP"
          ? "£"
          : "CHF";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Spending by Category</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={
                filteredData as unknown as Array<
                  Record<string, string | number>
                >
              }
              cx="50%"
              cy="50%"
              labelLine={false}
              label={
                ((props: Record<string, unknown>) => {
                  const category = props.category as string;
                  const outflow = props.outflow as number;
                  const currencySymbol = getCurrencySymbol();
                  return `${category}: ${currencySymbol}${(outflow / 1000).toFixed(0)}k`;
                }) as unknown as (props: unknown) => string
              }
              outerRadius={80}
              fill="#8884d8"
              dataKey="outflow"
            >
              {filteredData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
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
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
