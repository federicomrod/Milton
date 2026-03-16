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
import {
  TrendingUp,
  TrendingDown,
  PieChart,
  DollarSign,
  BarChart3,
  Users,
  type LucideIcon,
} from "lucide-react";

function getFormat(name: string): "currency" | "percentage" | "number" {
  const n = name?.toLowerCase() ?? "";
  if (
    n.includes("margin") ||
    n.includes("percentage") ||
    n.includes("rate") ||
    n.includes("growth rate")
  )
    return "percentage";
  return "currency";
}

function getCardStyle(kpi: {
  id: string;
  name: string;
  currentValue: number | null;
}): { icon: LucideIcon; iconColor: string; valueColor: string } {
  const n = kpi.name.toLowerCase();
  const id = kpi.id.toLowerCase();
  const value = kpi.currentValue ?? 0;

  if (id.includes("total-revenue") || n.includes("total revenue")) {
    return {
      icon: DollarSign,
      iconColor: "text-green-600",
      valueColor: "text-green-600",
    };
  }
  if (id.includes("mrr") || n.includes("mrr")) {
    return {
      icon: BarChart3,
      iconColor: "text-blue-600",
      valueColor: "text-blue-600",
    };
  }
  if (id.includes("revenue-growth") || n.includes("growth rate")) {
    return {
      icon: TrendingUp,
      iconColor: "text-emerald-600",
      valueColor: "text-emerald-600",
    };
  }
  if (id.includes("total-expenses") || n.includes("total expenses")) {
    return {
      icon: TrendingDown,
      iconColor: "text-rose-600",
      valueColor: "text-rose-600",
    };
  }
  if (id.includes("net-income") || n.includes("net income")) {
    const positive = value >= 0;
    return {
      icon: positive ? TrendingUp : TrendingDown,
      iconColor: positive ? "text-green-600" : "text-red-600",
      valueColor: positive ? "text-green-600" : "text-red-600",
    };
  }
  if (id.includes("revenue-per-fte") || n.includes("revenue per fte")) {
    return {
      icon: Users,
      iconColor: "text-violet-600",
      valueColor: "text-violet-600",
    };
  }
  if (id.includes("gross-margin") || n.includes("gross margin")) {
    return {
      icon: PieChart,
      iconColor: "text-amber-600",
      valueColor: "text-amber-600",
    };
  }
  if (n.includes("expense")) {
    return {
      icon: TrendingDown,
      iconColor: "text-rose-600",
      valueColor: "text-rose-600",
    };
  }
  if (n.includes("income") || n.includes("revenue")) {
    return {
      icon: TrendingUp,
      iconColor: "text-green-600",
      valueColor: "text-green-600",
    };
  }
  return { icon: PieChart, iconColor: "text-muted-foreground", valueColor: "" };
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
  if (format === "percentage") return formatPercentage((value ?? 0) / 100);
  return formatNumber(value, numberFormat);
}

interface CalculatedKpi {
  id: string;
  name: string;
  currentValue: number | null;
  historicalData?: { period: string; value: number }[];
  error?: string;
}

interface B2BSaaSFinancialsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
  /** When true, show budget charts (income statement, variance, YTD) above the KPI cards */
  showBudgetCharts?: boolean;
  budgetCharts?: React.ReactNode;
}

export function B2BSaaSFinancials({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
  showBudgetCharts = false,
  budgetCharts,
}: B2BSaaSFinancialsProps) {
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
        // Use unified KPI layer: financial metrics from transactions + orders
        // (no dependency on user's selected KPIs)
        const res = await fetch("/api/analytics/financial-metrics", {
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
          // List is already financial-only from the unified layer; include all returned
          setCalculated(list);
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
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">
            Loading financial data...
          </p>
        </div>
      </div>
    );
  }

  const hasCharts = showBudgetCharts && budgetCharts;
  const hasKpis = calculated.length > 0;

  if (!hasCharts && !hasKpis) {
    return (
      <div className="rounded border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No financial metrics available. Upload Transactions or budget data and
        select B2B SaaS KPIs (e.g. Net Income, Gross Margin, Total Expenses) to
        see Financials here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Profitability and expense metrics from your transactions and invoices.
        </p>
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>

      {hasCharts && <div className="space-y-4">{budgetCharts}</div>}

      {hasKpis && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {calculated.map((kpi) => {
            const format = getFormat(kpi.name);
            const value = kpi.error != null ? null : kpi.currentValue;
            const style = getCardStyle(kpi);
            const Icon = style.icon;
            return (
              <Card key={kpi.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {kpi.name}
                  </CardTitle>
                  <Icon className={`h-4 w-4 ${style.iconColor}`} />
                </CardHeader>
                <CardContent>
                  <div
                    className={`text-2xl font-bold ${style.valueColor || ""}`}
                  >
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
      )}
    </div>
  );
}
