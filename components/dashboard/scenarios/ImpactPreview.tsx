"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface ImpactPreviewKPI {
  label: string;
  value: string;
  delta: string;
  deltaPercentage: string;
  isPositive: boolean;
}

interface ImpactPreviewProps {
  hasChanges: boolean;
  /** Baseline KPIs from GET /api/report-data; when provided, used instead of mock */
  baselineKpis?: ImpactPreviewKPI[] | null;
}

interface KPICardProps {
  label: string;
  value: string;
  delta: string;
  deltaPercentage: string;
  isPositive: boolean;
}

function KPICard({
  label,
  value,
  delta,
  deltaPercentage,
  isPositive,
}: KPICardProps) {
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className="space-y-1">
          <p className="text-2xl font-semibold text-foreground">{value}</p>
          <div
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1 w-fit",
              isPositive
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="text-sm font-medium">{delta}</span>
            <span className="text-sm">({deltaPercentage})</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

const MOCK_KPIS: ImpactPreviewKPI[] = [
  {
    label: "Revenue",
    value: "€2.4M",
    delta: "+€240K",
    deltaPercentage: "+11%",
    isPositive: true,
  },
  {
    label: "Costs",
    value: "€1.6M",
    delta: "+€160K",
    deltaPercentage: "+11%",
    isPositive: false,
  },
  {
    label: "Net Income",
    value: "€800K",
    delta: "+€80K",
    deltaPercentage: "+11%",
    isPositive: true,
  },
  {
    label: "Cash Runway",
    value: "18 months",
    delta: "+2 months",
    deltaPercentage: "+12%",
    isPositive: true,
  },
];

export function ImpactPreview({
  hasChanges,
  baselineKpis,
}: ImpactPreviewProps) {
  const kpis =
    baselineKpis && baselineKpis.length > 0 ? baselineKpis : MOCK_KPIS;

  if (!hasChanges) {
    return (
      <div className="space-y-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{kpi.label}</p>
              <div className="space-y-1">
                <p className="text-2xl font-semibold text-muted-foreground/70">
                  {kpi.value}
                </p>
                <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1 w-fit">
                  <span className="text-sm text-muted-foreground">
                    No changes yet
                  </span>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {kpis.map((kpi) => (
        <KPICard key={kpi.label} {...kpi} />
      ))}
    </div>
  );
}
