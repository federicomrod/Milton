"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DollarSign,
  Users,
  Receipt,
  TrendingUp,
  TrendingDown,
  Percent,
} from "lucide-react";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { DatabaseKpi } from "@/lib/types/kpi";

interface KpiData {
  totalRevenue: number;
  covers: number;
  averageTicketSize: number;
  primeCostPercent: number;
  totalCOGS: number;
  totalLabor: number;
  primeCost: number;
}

interface TrendData {
  totalRevenue: number;
  covers: number;
  averageTicketSize: number;
  primeCostPercent: number;
}

export function RestaurantOverview() {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<"month" | "year" | "ytd" | "custom">(
    "month"
  );
  const [customDateRange, setCustomDateRange] = useState<{
    from: string;
    to: string;
  }>({
    from: new Date(new Date().setMonth(new Date().getMonth() - 1))
      .toISOString()
      .split("T")[0],
    to: new Date().toISOString().split("T")[0],
  });

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      let toDate = new Date();
      let fromDate = new Date();

      if (period === "year") {
        fromDate = new Date(new Date().getFullYear() - 1, 0, 1);
        toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59);
      } else if (period === "ytd") {
        fromDate = new Date(new Date().getFullYear(), 0, 1);
      } else if (period === "custom") {
        fromDate = new Date(customDateRange.from);
        toDate = new Date(customDateRange.to);
      } else {
        // month
        fromDate.setMonth(fromDate.getMonth() - 1);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      const response = await fetch(
        `/api/analytics/restaurant/overview?from_date=${fromDateStr}&to_date=${toDateStr}&period=${period}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch overview data");
      }

      const data = await response.json();
      setKpis(data.kpis || {});
      setTrends(data.trends || {});
    } catch (err) {
      console.error("Error fetching restaurant overview:", err);
      setError("Failed to load overview data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period, customDateRange]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const TrendIndicator = ({ trend }: { trend: number }) => {
    if (trend === 0) return null;
    const isPositive = trend > 0;
    const Icon = isPositive ? TrendingUp : TrendingDown;
    return (
      <div className="flex items-center gap-1 mt-1">
        {isPositive ? (
          <>
            <TrendingUp className="h-3 w-3 text-green-600" />
            <span className="text-xs text-green-600">+{trend.toFixed(1)}%</span>
          </>
        ) : (
          <>
            <TrendingDown className="h-3 w-3 text-red-600" />
            <span className="text-xs text-red-600">{trend.toFixed(1)}%</span>
          </>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">Loading overview...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-red-600">{error}</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              No data available. Please upload your restaurant data.
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DateRangePicker
            period={period}
            customDateRange={customDateRange}
            onPeriodChange={(value) => setPeriod(value)}
            onCustomDateRangeChange={(range) => setCustomDateRange(range)}
          />
        </div>
      </div>

      {/* Priority 1 KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          kpi={{
            id: "total-revenue",
            name: "Total Revenue",
            definition: "Revenue for the period",
          }}
          value={kpis.totalRevenue}
          icon={DollarSign}
          iconColor="text-green-600"
          valueColor="text-green-600"
          description={
            trends && trends.totalRevenue !== 0
              ? trends.totalRevenue > 0
                ? `↑ +${trends.totalRevenue.toFixed(1)}%`
                : `↓ ${trends.totalRevenue.toFixed(1)}%`
              : undefined
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "covers",
            name: "Covers",
            definition: "Guests served",
          }}
          value={kpis.covers}
          icon={Users}
          iconColor="text-blue-600"
          valueColor="text-blue-600"
          description={
            trends && trends.covers !== 0
              ? trends.covers > 0
                ? `↑ +${trends.covers.toFixed(1)}%`
                : `↓ ${trends.covers.toFixed(1)}%`
              : undefined
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "average-ticket-size",
            name: "Avg Ticket Size",
            definition: "Revenue per cover",
          }}
          value={kpis.averageTicketSize}
          icon={Receipt}
          iconColor="text-green-600"
          valueColor="text-green-600"
          description={
            trends && trends.averageTicketSize !== 0
              ? trends.averageTicketSize > 0
                ? `↑ +${trends.averageTicketSize.toFixed(1)}%`
                : `↓ ${trends.averageTicketSize.toFixed(1)}%`
              : undefined
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "prime-cost-percent",
            name: "Prime Cost %",
            definition: "COGS + Labor / Revenue",
          }}
          value={kpis.primeCostPercent}
          icon={Percent}
          iconColor={
            kpis.primeCostPercent < 60
              ? "text-green-600"
              : kpis.primeCostPercent < 65
                ? "text-yellow-600"
                : "text-red-600"
          }
          valueColor={
            kpis.primeCostPercent < 60
              ? "text-green-600"
              : kpis.primeCostPercent < 65
                ? "text-yellow-600"
                : "text-red-600"
          }
          suffix="%"
          description={
            trends && trends.primeCostPercent !== 0
              ? trends.primeCostPercent > 0
                ? `+${trends.primeCostPercent.toFixed(1)}pp`
                : `${trends.primeCostPercent.toFixed(1)}pp`
              : undefined
          }
          fetchFromApi={false}
        />
      </div>

      {/* Prime Cost Breakdown */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">COGS</CardTitle>
            <DollarSign className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-orange-600">
              {formatCurrency(kpis.totalCOGS)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Cost of Goods Sold
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Labor</CardTitle>
            <Users className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-semibold text-purple-600">
              {formatCurrency(kpis.totalLabor)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Total labor costs
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Prime Cost
            </CardTitle>
            <DollarSign
              className={`h-4 w-4 ${
                kpis.primeCostPercent < 60
                  ? "text-green-600"
                  : kpis.primeCostPercent < 65
                    ? "text-yellow-600"
                    : "text-red-600"
              }`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-xl font-semibold ${
                kpis.primeCostPercent < 60
                  ? "text-green-600"
                  : kpis.primeCostPercent < 65
                    ? "text-yellow-600"
                    : "text-red-600"
              }`}
            >
              {formatCurrency(kpis.primeCost)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">COGS + Labor</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
