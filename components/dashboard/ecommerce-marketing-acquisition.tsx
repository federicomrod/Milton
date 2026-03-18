"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";

interface ChannelBreakdown {
  channel: string;
  spend: number;
  percentage: number;
}

interface KpiHistorical {
  period: string;
  value: number;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

interface EcommerceMarketingAcquisitionProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function EcommerceMarketingAcquisition({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: EcommerceMarketingAcquisitionProps) {
  const [spendByChannel, setSpendByChannel] = useState<ChannelBreakdown[]>([]);
  const [totalSpend, setTotalSpend] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [marketingEfficiency, setMarketingEfficiency] = useState(0);
  const [kpis, setKpis] = useState<Record<string, number | null>>({});
  const [historical, setHistorical] = useState<Record<string, KpiHistorical[]>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
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
        fromDate.setMonth(fromDate.getMonth() - 1);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      const [marketingRes, kpisRes] = await Promise.all([
        fetch(
          `/api/analytics/ecommerce/marketing?from_date=${fromDateStr}&to_date=${toDateStr}`,
          { cache: "no-store", credentials: "include" }
        ),
        fetch(
          `/api/analytics/ecommerce/kpis?from_date=${fromDateStr}&to_date=${toDateStr}`,
          { cache: "no-store", credentials: "include" }
        ),
      ]);

      if (marketingRes.ok) {
        const marketingData = await marketingRes.json();
        setSpendByChannel(marketingData.spendByChannel || []);
        setTotalSpend(marketingData.totalSpend ?? 0);
        setTotalRevenue(marketingData.totalRevenue ?? 0);
        setMarketingEfficiency(marketingData.marketingEfficiency ?? 0);
      }

      if (kpisRes.ok) {
        const kpisData = await kpisRes.json();
        setKpis(kpisData.kpis || {});
        setHistorical(kpisData.historical || {});
      }
    } catch (err) {
      console.error("Error fetching marketing data:", err);
      setError("Failed to load marketing & acquisition data");
    } finally {
      setLoading(false);
    }
  }, [period, customDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">
              Loading marketing & acquisition data...
            </p>
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

  const chartData =
    historical.marketingEfficiency?.map((h) => ({
      period: h.period,
      roas: h.value,
    })) ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CAC (Customer Acquisition Cost)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.cac != null ? formatCurrency(kpis.cac) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CAC Payback (months)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.cacPayback != null ? kpis.cacPayback.toFixed(1) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Marketing Efficiency (ROAS)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.marketingEfficiency != null
                ? kpis.marketingEfficiency.toFixed(2)
                : marketingEfficiency > 0
                  ? marketingEfficiency.toFixed(2)
                  : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              CMAM (%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.cmam != null ? formatPercent(kpis.cmam) : "—"}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Marketing Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalSpend)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Growth Quality Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {kpis.growthQualityScore != null
                ? kpis.growthQualityScore.toFixed(2)
                : "—"}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {spendByChannel.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={
                      spendByChannel as unknown as Array<
                        Record<string, string | number>
                      >
                    }
                    dataKey="spend"
                    nameKey="channel"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={
                      ((props: Record<string, unknown>) => {
                        const channel = props.channel as string;
                        const percentage = props.percentage as number;
                        return `${channel}: ${percentage.toFixed(1)}%`;
                      }) as unknown as (props: unknown) => string
                    }
                  >
                    {spendByChannel.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No marketing spend data available
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marketing Efficiency Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip formatter={(v: number) => v?.toFixed(2)} />
                  <Line
                    type="monotone"
                    dataKey="roas"
                    stroke="#7c3aed"
                    strokeWidth={2}
                    name="ROAS"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No historical data available
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
