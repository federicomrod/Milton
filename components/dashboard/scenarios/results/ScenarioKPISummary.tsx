"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KPICardProps {
  title: string;
  value: string;
  delta: string;
  deltaPercent: string;
  isPositive: boolean;
}

function KPICard({
  title,
  value,
  delta,
  deltaPercent,
  isPositive,
}: KPICardProps) {
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <p className="text-muted-foreground">{title}</p>
        <Icon
          className={cn(
            "h-5 w-5 shrink-0",
            isPositive ? "text-emerald-600" : "text-destructive"
          )}
        />
      </div>
      <div className="space-y-2">
        <p className="text-3xl font-semibold text-foreground">{value}</p>
        <div
          className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-md text-sm",
            isPositive
              ? "bg-emerald-500/10 text-emerald-600"
              : "bg-destructive/10 text-destructive"
          )}
        >
          <span>
            {isPositive ? "▲" : "▼"} {delta}
          </span>
          <span>({deltaPercent})</span>
        </div>
        <p className="text-sm text-muted-foreground">vs baseline</p>
      </div>
    </Card>
  );
}

export interface ScenarioKPI {
  title: string;
  value: string;
  delta: string;
  deltaPercent: string;
  isPositive: boolean;
}

interface ScenarioKPISummaryProps {
  kpis?: ScenarioKPI[];
}

const defaultKpis: ScenarioKPI[] = [
  {
    title: "Revenue",
    value: "$8.4M",
    delta: "$2.1M",
    deltaPercent: "+33%",
    isPositive: true,
  },
  {
    title: "Costs",
    value: "$4.8M",
    delta: "$1.2M",
    deltaPercent: "+25%",
    isPositive: false,
  },
  {
    title: "Net Income",
    value: "$3.6M",
    delta: "$900K",
    deltaPercent: "+33%",
    isPositive: true,
  },
  {
    title: "Cash Runway",
    value: "18 months",
    delta: "+3 months",
    deltaPercent: "+20%",
    isPositive: true,
  },
];

export function ScenarioKPISummary({
  kpis = defaultKpis,
}: ScenarioKPISummaryProps) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground mb-4">
        Scenario Impact
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <KPICard key={kpi.title} {...kpi} />
        ))}
      </div>
    </div>
  );
}
