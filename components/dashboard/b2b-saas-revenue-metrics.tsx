"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { useUserPreferences } from "@/lib/context/UserPreferencesContext";
import {
  formatCurrency,
  formatNumber,
  formatPercentage,
} from "@/lib/utils/formatters";
import { DollarSign, Users, BarChart3 } from "lucide-react";

const REVENUE_KPI_KEYWORDS = [
  "total revenue",
  "mrr",
  "monthly recurring",
  "revenue growth",
  "arpa",
  "revenue per customer",
  "revenue by channel",
  "average order value",
  "aov",
  "active customers",
  "pipeline volume",
  "weighted pipeline",
];

function isRevenueKpi(name: string): boolean {
  const n = name?.toLowerCase().trim() ?? "";
  return REVENUE_KPI_KEYWORDS.some((kw) => n.includes(kw));
}

function getFormat(name: string): "currency" | "percentage" | "number" {
  const n = name?.toLowerCase() ?? "";
  if (n.includes("rate") || n.includes("growth") || n.includes("percentage"))
    return "percentage";
  if (
    n.includes("revenue") ||
    n.includes("value") ||
    n.includes("aov") ||
    n.includes("arpa") ||
    n.includes("pipeline")
  )
    return "currency";
  return "number";
}

function formatValue(
  value: number | null,
  format: "currency" | "percentage" | "number",
  currency: string,
  numberFormat: string
): string {
  if (value == null) return "—";
  if (format === "currency")
    return formatCurrency(value, currency, numberFormat);
  if (format === "percentage") return formatPercentage(value);
  return formatNumber(value, numberFormat);
}

interface CalculatedKpi {
  id: string;
  name: string;
  currentValue: number | null;
  historicalData?: { period: string; value: number }[];
  error?: string;
}

interface B2BSaaSRevenueMetricsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function B2BSaaSRevenueMetrics({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: B2BSaaSRevenueMetricsProps) {
  const { prefs } = useUserPreferences();
  const [calculated, setCalculated] = useState<CalculatedKpi[]>([]);
  const [loading, setLoading] = useState(true);

  const fromDate =
    period === "custom"
      ? customDateRange.from
      : period === "year"
        ? new Date(new Date().setFullYear(new Date().getFullYear() - 1))
            .toISOString()
            .split("T")[0]
        : period === "ytd"
          ? new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0]
          : new Date(new Date().setMonth(new Date().getMonth() - 1))
              .toISOString()
              .split("T")[0];
  const toDate =
    period === "custom"
      ? customDateRange.to
      : new Date().toISOString().split("T")[0];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/kpis/calculate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from_date: fromDate, to_date: toDate }),
        });
        const data = await res.json().catch(() => ({}));
        const list = Array.isArray(data.calculatedKpis)
          ? data.calculatedKpis
          : [];
        if (!cancelled) {
          const revenueOnly = list.filter((k: CalculatedKpi) =>
            isRevenueKpi(k.name)
          );
          setCalculated(revenueOnly);
        }
      } catch {
        if (!cancelled) setCalculated([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromDate, toDate]);

  const currency = prefs?.currency ?? "USD";
  const numberFormat = prefs?.number_format ?? "1.0-0";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (calculated.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No revenue metrics available. Upload CRM, Invoices, or Subscriptions
        data and select B2B SaaS KPIs in onboarding to see Revenue & MRR here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Key revenue and growth metrics from your subscriptions, invoices, and
          CRM.
        </p>
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {calculated.map((kpi) => {
          const format = getFormat(kpi.name);
          const value = kpi.error != null ? null : kpi.currentValue;
          const icon =
            kpi.name.toLowerCase().includes("customer") ||
            kpi.name.toLowerCase().includes("pipeline") ? (
              <Users className="h-4 w-4 text-muted-foreground" />
            ) : kpi.name.toLowerCase().includes("channel") ? (
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            );
          return (
            <Card key={kpi.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {kpi.name}
                </CardTitle>
                {icon}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatValue(value, format, currency, numberFormat)}
                </div>
                {kpi.error && (
                  <p className="text-xs text-destructive mt-1">{kpi.error}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
