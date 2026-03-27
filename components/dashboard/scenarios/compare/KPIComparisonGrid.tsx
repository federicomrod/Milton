"use client";

import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface KPIComparisonRow {
  name: string;
  key: string;
  values: Record<string, number>;
}

interface KPIComparisonGridProps {
  scenarios: Array<{ id: string; name: string }>;
  kpiData: KPIComparisonRow[];
  baselineId: string;
}

function formatValue(value: number, key: string): string {
  if (key === "runway") {
    return `${value} months`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
}

function formatDelta(value: number, baseline: number) {
  const delta = value - baseline;
  const percentage = baseline !== 0 ? (delta / baseline) * 100 : 0;
  return { delta, percentage, isPositive: delta >= 0 };
}

export function KPIComparisonGrid({
  scenarios,
  kpiData,
  baselineId,
}: KPIComparisonGridProps) {
  return (
    <Card className="overflow-hidden p-0">
      <div
        className="grid gap-0"
        style={{
          gridTemplateColumns: `180px repeat(${scenarios.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Header */}
        <div className="bg-muted/50 border-b border-border px-4 py-3">
          <span className="text-sm text-muted-foreground">KPI</span>
        </div>
        {scenarios.map((scenario) => (
          <div
            key={scenario.id}
            className="bg-muted/50 border-b border-l border-border px-4 py-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium truncate">
                {scenario.name}
              </span>
              {scenario.id === baselineId && (
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded shrink-0">
                  Baseline
                </span>
              )}
            </div>
          </div>
        ))}

        {/* KPI Rows */}
        {kpiData.map((kpi, index) => (
          <React.Fragment key={kpi.key}>
            <div
              key={`${kpi.key}-label`}
              className={cn(
                "px-4 py-4 border-b border-border",
                index % 2 === 0 ? "bg-card" : "bg-muted/30"
              )}
            >
              <span className="text-sm font-medium">{kpi.name}</span>
            </div>
            {scenarios.map((scenario) => {
              const value = kpi.values[scenario.id] ?? 0;
              const baselineValue = kpi.values[baselineId] ?? 0;
              const { percentage, isPositive } = formatDelta(
                value,
                baselineValue
              );
              const isBaseline = scenario.id === baselineId;

              return (
                <div
                  key={`${kpi.key}-${scenario.id}`}
                  className={cn(
                    "px-4 py-4 border-b border-l border-border",
                    index % 2 === 0 ? "bg-card" : "bg-muted/30"
                  )}
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-lg font-semibold text-foreground">
                      {formatValue(value, kpi.key)}
                    </span>
                    {!isBaseline && (
                      <div
                        className={cn(
                          "flex items-center gap-1 text-sm",
                          isPositive ? "text-emerald-600" : "text-destructive"
                        )}
                      >
                        {isPositive ? (
                          <TrendingUp size={14} />
                        ) : (
                          <TrendingDown size={14} />
                        )}
                        <span>
                          {isPositive ? "+" : ""}
                          {percentage.toFixed(1)}%
                        </span>
                        <span className="text-muted-foreground">
                          vs baseline
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}
