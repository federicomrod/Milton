"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Loader2, LucideIcon } from "lucide-react";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import { KpiTargetPopover } from "@/components/dashboard/kpi-target-popover";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/utils/formatters";

type KpiFormat = "number" | "currency" | "percentage" | "months";

// Dynamic KPI display format based on KPI name (reused from kpis-grid.tsx)
const getKpiDisplayFormat = (kpiName: string): KpiFormat => {
  const name = kpiName?.toLowerCase().trim();

  if (
    (name?.includes("rate") && !name?.includes("burn")) ||
    name?.includes("percentage") ||
    name?.includes("utilization") ||
    name?.includes("no show") ||
    name?.includes("no-show") ||
    name?.includes("churn") ||
    name?.includes("attendance") ||
    name?.includes("occupancy") ||
    name?.includes("cancellation")
  ) {
    // Special case: burn rate should be currency, not percentage
    if (name?.includes("burn rate")) {
      return "currency";
    }
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
  } else if (name?.includes("tenure") || name?.includes("months")) {
    return "months";
  } else if (
    name?.includes("count") ||
    name?.includes("number") ||
    name?.includes("members") ||
    name?.includes("classes") ||
    name?.includes("size") ||
    name?.includes("runway") ||
    name?.includes("covers") ||
    name?.includes("age")
  ) {
    return "number";
  }

  return "number"; // default
};

interface KpiCardProps {
  kpi: DatabaseKpi;
  // Optional: if provided, use this value instead of fetching from API
  value?: number | null;
  // Optional: custom icon component
  icon?: LucideIcon;
  // Optional: custom icon color class
  iconColor?: string;
  // Optional: custom value color class
  valueColor?: string;
  // Optional: custom suffix (e.g., " mo", "%")
  suffix?: string;
  // Optional: additional description text below the value
  description?: string;
  // Optional: whether to fetch from API (default: true if value not provided)
  fetchFromApi?: boolean;
  hasRequiredData?: boolean;
  missingTables?: string[];
  // KPI targets
  modelId?: string;
  period?: string;
  customDateRange?: { from: string; to: string };
}

export function KpiCard({
  kpi,
  value: providedValue,
  icon: IconComponent,
  iconColor: providedIconColor,
  valueColor: providedValueColor,
  suffix: providedSuffix,
  description,
  fetchFromApi = true,
  hasRequiredData = true,
  missingTables = [],
  modelId,
  period,
  customDateRange,
}: KpiCardProps) {
  const { prefs } = useUserPreferences();
  const [currentValue, setCurrentValue] = useState<number | null>(
    providedValue ?? null
  );
  const [loading, setLoading] = useState(
    fetchFromApi && providedValue === undefined
  );
  const [error, setError] = useState<string | null>(null);

  const format = getKpiDisplayFormat(kpi.name);

  // Fetch current KPI value from API if needed
  useEffect(() => {
    // If value is provided, don't fetch
    if (providedValue !== undefined || !fetchFromApi) {
      setLoading(false);
      return;
    }

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
          // For "Total" KPIs, sum all values in the series
          const isTotalKpi = kpi.name.toLowerCase().includes("total");
          if (isTotalKpi) {
            const totalValue = series.data.reduce(
              (sum: number, point: any) => sum + (point.value || 0),
              0
            );
            setCurrentValue(totalValue);
          } else {
            // Get the most recent value for other KPIs
            const latestPoint = series.data[series.data.length - 1];
            setCurrentValue(latestPoint.value ?? null);
          }
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
  }, [kpi.id, kpi.name, hasRequiredData, providedValue, fetchFromApi]);

  // Update currentValue when providedValue changes
  useEffect(() => {
    if (providedValue !== undefined) {
      setCurrentValue(providedValue);
    }
  }, [providedValue]);

  const formatValue = (value: number | null): string => {
    if (value === null || value === undefined) {
      return "N/A";
    }

    if (format === "currency") {
      return formatCurrency(value, prefs.currency, prefs.number_format);
    } else if (format === "percentage") {
      // For percentage format, value is already a percentage (0-100), not decimal.
      // Safeguard: if value > 100, treat as double-scaled (e.g. 1800 instead of 18).
      const normalized = value > 100 ? value / 100 : value;
      if (providedSuffix !== undefined) {
        return normalized.toFixed(1);
      }
      return formatPercentage(normalized / 100);
    } else if (format === "months") {
      return value.toFixed(1);
    } else {
      return formatNumber(value, prefs.number_format);
    }
  };

  const getIconColor = (): string => {
    if (providedIconColor) return providedIconColor;
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

  const getValueColor = (): string => {
    if (providedValueColor) return providedValueColor;
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

  const getSuffix = (): string => {
    if (providedSuffix !== undefined) return providedSuffix;
    if (format === "percentage") return "%";
    if (format === "months") return " mo";
    return "";
  };

  const DisplayIcon = IconComponent || BarChart3;

  // Clean up KPI name for display
  const displayName = kpi.name
    .replace(" (End of Month)", "")
    .replace(" (ARPM)", "")
    .trim();

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{displayName}</CardTitle>
        <div className="flex items-center gap-1.5">
          {modelId && (
            <KpiTargetPopover
              kpiId={kpi.id}
              kpiName={displayName}
              modelId={modelId}
              period={period}
              customDateRange={customDateRange}
              format={format}
            />
          )}
          <DisplayIcon className={`h-4 w-4 ${getIconColor()}`} />
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : !hasRequiredData ? (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getValueColor()}`}>—</div>
            <p className="text-xs text-muted-foreground">
              Required data tables missing
            </p>
            <p className="text-xs text-muted-foreground/60">
              Upload data for: {missingTables.join(", ")}
            </p>
          </div>
        ) : error ? (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getValueColor()}`}>—</div>
            <p className="text-xs text-muted-foreground">{error}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <div className={`text-2xl font-bold ${getValueColor()}`}>
              {formatValue(currentValue)}
              {/* 
                Add suffix unless:
                - currency (already in formatCurrency)
                - percentage when using formatPercentage (already includes %)
                But DO add suffix when a custom suffix is provided for percentage
              */}
              {format === "currency"
                ? null
                : format === "percentage" && providedSuffix === undefined
                  ? null
                  : getSuffix()}
            </div>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">
                {description}
              </p>
            )}
            {kpi.definition && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {kpi.definition}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
