"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Loader2 } from "lucide-react";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/utils/formatters";

type KpiFormat = "number" | "currency" | "percentage";

// Dynamic KPI display format based on KPI name (reused from kpis-grid.tsx)
const getKpiDisplayFormat = (kpiName: string): KpiFormat => {
  const name = kpiName?.toLowerCase().trim();

  if (
    name?.includes("rate") ||
    name?.includes("percentage") ||
    name?.includes("utilization") ||
    name?.includes("no show") ||
    name?.includes("no-show") ||
    name?.includes("churn") ||
    name?.includes("attendance") ||
    name?.includes("occupancy") ||
    name?.includes("cancellation")
  ) {
    return "percentage";
  } else if (
    name?.includes("revenue") ||
    name?.includes("income") ||
    name?.includes("burn") ||
    name?.includes("cost") ||
    name?.includes("expense") ||
    name?.includes("profit")
  ) {
    return "currency";
  } else if (
    name?.includes("count") ||
    name?.includes("number") ||
    name?.includes("members") ||
    name?.includes("classes") ||
    name?.includes("size") ||
    name?.includes("tenure") ||
    name?.includes("runway")
  ) {
    return "number";
  }

  return "number"; // default
};

interface KpiCardProps {
  kpi: DatabaseKpi;
  hasRequiredData?: boolean;
  missingTables?: string[];
}

export function KpiCard({
  kpi,
  hasRequiredData = true,
  missingTables = [],
}: KpiCardProps) {
  const { prefs } = useUserPreferences();
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const format = getKpiDisplayFormat(kpi.name);

  // Fetch current KPI value
  useEffect(() => {
    const fetchValue = async () => {
      try {
        setLoading(true);
        setError(null);

        // Fetch latest value from series API (get most recent point)
        const response = await fetch(
          `/api/kpis/series?kpiIds=${encodeURIComponent(kpi.id)}`,
          {
            cache: "no-store",
            credentials: "include",
          }
        );

        if (!response.ok) {
          throw new Error("Failed to fetch KPI value");
        }

        const data = await response.json();
        const series = data.series?.[kpi.id];

        if (
          series?.data &&
          Array.isArray(series.data) &&
          series.data.length > 0
        ) {
          // Get the most recent value
          const latestPoint = series.data[series.data.length - 1];
          setCurrentValue(latestPoint.value ?? null);
        } else {
          setCurrentValue(null);
        }
      } catch (err) {
        console.error(`[KpiCard] Error fetching value for ${kpi.name}:`, err);
        setError("Failed to load");
        setCurrentValue(null);
      } finally {
        setLoading(false);
      }
    };

    if (hasRequiredData) {
      fetchValue();
    } else {
      setLoading(false);
    }
  }, [kpi.id, kpi.name, hasRequiredData]);

  const formatValue = (value: number | null): string => {
    if (value === null || value === undefined) {
      return "N/A";
    }

    if (format === "currency") {
      return formatCurrency(value, prefs.currency, prefs.number_format);
    } else if (format === "percentage") {
      return formatPercentage(value / 100);
    } else {
      return formatNumber(value, prefs.number_format);
    }
  };

  const getColorClass = (): string => {
    if (!hasRequiredData) {
      return "text-muted-foreground";
    }
    if (format === "currency") {
      return "text-green-600";
    } else if (format === "percentage") {
      return "text-blue-600";
    }
    return "text-gray-700";
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{kpi.name}</CardTitle>
        <BarChart3 className={`h-4 w-4 ${getColorClass()}`} />
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : !hasRequiredData ? (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getColorClass()}`}>—</div>
            <p className="text-xs text-muted-foreground">
              Required data tables missing
            </p>
            <p className="text-xs text-muted-foreground/60">
              Upload data for: {missingTables.join(", ")}
            </p>
          </div>
        ) : error ? (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getColorClass()}`}>—</div>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getColorClass()}`}>
              {formatValue(currentValue)}
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">
              {kpi.definition}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
