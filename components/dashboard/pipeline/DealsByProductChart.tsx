// components/dashboard/pipeline/DealsByProductChart.tsx
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
  LabelList,
} from "recharts";
import type { PhaseColors } from "@/lib/utils/pipeline-utils";
import { formatCurrency } from "@/lib/utils/pipeline-utils";
import type { FormatStyle } from "@/lib/utils/pipeline-utils";

interface ProductData {
  product: string;
  value: number;
}

interface DealsByProductChartProps {
  data: ProductData[];
  colors: PhaseColors;
  currency: string;
  formatStyle: FormatStyle;
}

export function DealsByProductChart({
  data,
  colors,
  currency,
  formatStyle,
}: DealsByProductChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Closed Deals by Product</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded border p-6 text-center text-sm text-gray-500">
            <p>📦 No product data available.</p>
            <p className="text-xs mt-2">
              Upload CRM data with a &quot;Product&quot; or &quot;Product
              Type&quot; column to see this chart.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dealColor = colors["Deal"];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Closed Deals by Product</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart
            data={data}
            margin={{ top: 30, right: 30, left: 20, bottom: 100 }}
          >
            <defs>
              <linearGradient
                id="gradientDealProduct"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="5%" stopColor={dealColor} stopOpacity={0.9} />
                <stop offset="95%" stopColor={dealColor} stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              opacity={0.4}
            />
            <XAxis
              dataKey="product"
              angle={-45}
              textAnchor="end"
              height={100}
              tick={{ fontSize: 11, fill: "#6b7280", fontWeight: 500 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
              interval={0}
            />
            <YAxis
              tickFormatter={(value) =>
                formatCurrency(value, currency, formatStyle)
              }
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <Tooltip
              formatter={(value: number | string) => [
                formatCurrency(Number(value), currency, formatStyle),
                "Deal Value",
              ]}
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
              dataKey="value"
              fill="url(#gradientDealProduct)"
              name="Total Deal Value"
              radius={[8, 8, 0, 0]}
            >
              <LabelList
                dataKey="value"
                position="top"
                formatter={(value: unknown) => {
                  if (value === undefined || value === null) return "";
                  return formatCurrency(Number(value), currency, formatStyle);
                }}
                style={{
                  fontSize: "12px",
                  fontWeight: "bold",
                  fill: "#111827",
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
