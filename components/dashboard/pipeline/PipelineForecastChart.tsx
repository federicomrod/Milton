// components/dashboard/pipeline/PipelineForecastChart.tsx
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
import type { PhaseColors } from "@/lib/utils/pipeline-utils";
import { formatCurrency, PHASE_WEIGHTS } from "@/lib/utils/pipeline-utils";
import type { FormatStyle } from "@/lib/utils/pipeline-utils";
import { useState } from "react";

interface ForecastMonthData {
  month: string;
  [key: string]: string | number;
}

interface TooltipPayload {
  name: string;
  value: number | string;
  color: string;
  dataKey: string;
  payload?: Record<string, unknown>;
}

interface TooltipProps {
  active?: boolean;
  payload?: readonly TooltipPayload[];
  label?: string;
}

interface PipelineForecastChartProps {
  data: ForecastMonthData[];
  colors: PhaseColors;
  currency: string;
  formatStyle: FormatStyle;
}

export function PipelineForecastChart({
  data,
  colors,
  currency,
  formatStyle,
}: PipelineForecastChartProps) {
  const [showWeighted, setShowWeighted] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle>Pipeline Forecast by Closing Date</CardTitle>
          <ToggleGroup
            type="single"
            value={showWeighted ? "weighted" : "unweighted"}
            onValueChange={(value) => setShowWeighted(value === "weighted")}
          >
            <ToggleGroupItem value="unweighted" aria-label="Unweighted">
              Unweighted
            </ToggleGroupItem>
            <ToggleGroupItem value="weighted" aria-label="Weighted">
              Weighted
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={data}
            margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          >
            <defs>
              {[
                "Lead Generation",
                "First Contact",
                "Need Qualification",
                "Negotiation",
              ].map((phase) => {
                const color = colors[phase];
                const gradientId = `gradient-forecast-${phase.replace(/\s+/g, "-").toLowerCase()}`;
                return (
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
                );
              })}
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
              tickFormatter={(value) =>
                formatCurrency(value, currency, formatStyle)
              }
              tick={{ fill: "#6b7280", fontSize: 11 }}
              axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
            />
            <Tooltip
              formatter={(value: number | string) =>
                formatCurrency(Number(value), currency, formatStyle)
              }
              content={(props) => {
                const { active, payload, label } = props as TooltipProps;
                if (active && payload && payload.length) {
                  const totalKey = showWeighted ? "total_weighted" : "total";
                  return (
                    <div
                      className="bg-white p-4 border rounded-lg shadow-lg"
                      style={{
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                    >
                      <p
                        className="font-semibold mb-2"
                        style={{ color: "#111827", marginBottom: "8px" }}
                      >
                        {label}
                      </p>
                      {payload.map((entry: TooltipPayload, index: number) => (
                        <p
                          key={index}
                          className="text-sm"
                          style={{ color: entry.color }}
                        >
                          {entry.name}:{" "}
                          {formatCurrency(
                            Number(entry.value),
                            currency,
                            formatStyle
                          )}
                          {showWeighted && PHASE_WEIGHTS[entry.name] && (
                            <span className="text-gray-500">
                              {" "}
                              ({PHASE_WEIGHTS[entry.name] * 100}%)
                            </span>
                          )}
                        </p>
                      ))}
                      <p
                        className="text-sm font-semibold mt-2"
                        style={{ marginTop: "8px" }}
                      >
                        Total:{" "}
                        {formatCurrency(
                          Number(payload[0]?.payload?.[totalKey] || 0),
                          currency,
                          formatStyle
                        )}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Legend
              wrapperStyle={{ paddingTop: "24px" }}
              iconType="circle"
              iconSize={10}
            />
            <Bar
              dataKey={
                showWeighted ? "Lead Generation_weighted" : "Lead Generation"
              }
              stackId="a"
              fill={`url(#gradient-forecast-lead-generation)`}
              name="Lead Generation"
              radius={[8, 8, 0, 0]}
            />
            <Bar
              dataKey={
                showWeighted ? "First Contact_weighted" : "First Contact"
              }
              stackId="a"
              fill={`url(#gradient-forecast-first-contact)`}
              name="First Contact"
              radius={[8, 8, 0, 0]}
            />
            <Bar
              dataKey={
                showWeighted
                  ? "Need Qualification_weighted"
                  : "Need Qualification"
              }
              stackId="a"
              fill={`url(#gradient-forecast-need-qualification)`}
              name="Need Qualification"
              radius={[8, 8, 0, 0]}
            />
            <Bar
              dataKey={showWeighted ? "Negotiation_weighted" : "Negotiation"}
              stackId="a"
              fill={`url(#gradient-forecast-negotiation)`}
              name="Negotiation"
              radius={[8, 8, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
        {showWeighted && (
          <div className="mt-4 text-sm text-gray-600">
            <p className="font-semibold mb-1">Phase Weights:</p>
            <div className="grid grid-cols-4 gap-2">
              {Object.entries(PHASE_WEIGHTS)
                .slice(0, 4)
                .map(([phase, weight]) => (
                  <span key={phase}>
                    {phase}: {weight * 100}%
                  </span>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
