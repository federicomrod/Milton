"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  Users,
  UserCheck,
  UserX,
  Clock,
  Calendar,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { DatabaseKpi } from "@/lib/types/kpi";

interface MembersAnalyticsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

interface KpiData {
  totalMembers: number;
  activeMembers: number;
  inactiveMembers: number;
  avgAge: number;
  avgBookingsPerMonth: number;
  netGrowth: number;
  avgTenure: number;
}

interface ChartData {
  tenureDistribution: Array<{ label: string; value: number }>;
  genderSplit: Array<{ label: string; value: number }>;
  subscriptionType: Array<{ type: string; count: number; value: number }>;
  cohortChurn: Array<{
    cohort: string;
    total: number;
    churned: number;
    churnRate: number;
  }>;
}

const COLORS = {
  primary: "#3B82F6",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  purple: "#8B5CF6",
  pink: "#EC4899",
  teal: "#14B8A6",
};

const PIE_COLORS = [
  "#3B82F6", // Blue
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#10B981", // Green
  "#F59E0B", // Orange
  "#EF4444", // Red
];

export function MembersAnalytics({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: MembersAnalyticsProps) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [charts, setCharts] = useState<ChartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, [period, customDateRange]);

  const loadData = async () => {
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
        // month - default to last 6 months for charts, current period for KPIs
        fromDate.setMonth(fromDate.getMonth() - 6);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      const response = await fetch(
        `/api/analytics/fitness-studio/members?from_date=${fromDateStr}&to_date=${toDateStr}`,
        { cache: "no-store", credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch members analytics data");
      }

      const json = await response.json();
      setKpis(json.kpis || null);
      setCharts(json.charts || null);
    } catch (err) {
      console.error("Error loading members analytics data:", err);
      setError("Failed to load data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-sm text-muted-foreground">
            Loading members analytics data...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Members Analytics</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track member growth, demographics, and retention metrics
          </p>
        </div>
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          kpi={{
            id: "total-members",
            name: "Total Members",
            definition: "Total number of members",
          }}
          value={kpis?.totalMembers || 0}
          icon={Users}
          iconColor="text-blue-600"
          valueColor="text-blue-600"
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "active-members",
            name: "Active Members",
            definition: "Currently active members",
          }}
          value={kpis?.activeMembers || 0}
          icon={UserCheck}
          iconColor="text-green-600"
          valueColor="text-green-600"
          description={`${kpis?.inactiveMembers || 0} inactive`}
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "avg-age",
            name: "Average Age",
            definition: "Average age of members",
          }}
          value={kpis?.avgAge || 0}
          icon={Users}
          iconColor="text-pink-600"
          valueColor="text-pink-600"
          suffix=" Yrs"
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "avg-bookings-per-month",
            name: "Avg. Bookings / Mo",
            definition: "Average bookings per member per month",
          }}
          value={kpis?.avgBookingsPerMonth || 0}
          icon={Calendar}
          iconColor="text-purple-600"
          valueColor="text-purple-600"
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "net-growth",
            name: "Net Growth (New - Churn)",
            definition: "Net member growth (new members minus churned)",
          }}
          value={kpis?.netGrowth || 0}
          icon={TrendingUp}
          iconColor={
            (kpis?.netGrowth || 0) >= 0 ? "text-green-600" : "text-red-600"
          }
          valueColor={
            (kpis?.netGrowth || 0) >= 0 ? "text-green-600" : "text-red-600"
          }
          suffix={(kpis?.netGrowth || 0) >= 0 ? "" : ""}
          description={
            (kpis?.netGrowth || 0) >= 0
              ? `+${kpis?.netGrowth || 0}`
              : `${kpis?.netGrowth || 0}`
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "avg-tenure",
            name: "Avg. Tenure",
            definition: "Average member tenure in months",
          }}
          value={kpis?.avgTenure || 0}
          icon={Clock}
          iconColor="text-orange-600"
          valueColor="text-orange-600"
          suffix=" Months"
          fetchFromApi={false}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Tenure Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Member Tenure Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {charts?.tenureDistribution &&
            charts.tenureDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={charts.tenureDistribution}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <defs>
                    <linearGradient
                      id="tenureGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.9} />
                      <stop
                        offset="95%"
                        stopColor="#2563eb"
                        stopOpacity={0.8}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    opacity={0.4}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
                    axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                    tickLine={{ stroke: "#d1d5db" }}
                  />
                  <YAxis
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                    tickLine={{ stroke: "#d1d5db" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      padding: "12px",
                    }}
                    labelStyle={{
                      color: "#111827",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                    formatter={(value: number) => [
                      value.toLocaleString(),
                      "Members",
                    ]}
                  />
                  <Bar
                    dataKey="value"
                    fill="url(#tenureGradient)"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={60}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Alert className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No data available for the selected date range. Please adjust
                  your filters or upload data for this period.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Gender Split */}
        <Card>
          <CardHeader>
            <CardTitle>Gender Split</CardTitle>
          </CardHeader>
          <CardContent>
            {charts?.genderSplit && charts.genderSplit.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={charts.genderSplit}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={false}
                    outerRadius={100}
                    innerRadius={40}
                    fill="#8884d8"
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {charts.genderSplit.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                        stroke="#ffffff"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      padding: "12px",
                    }}
                    labelStyle={{
                      color: "#111827",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                    formatter={(value: number, name: string, props: any) => {
                      const total = charts.genderSplit.reduce(
                        (sum, e) => sum + e.value,
                        0
                      );
                      const percentage = ((value / total) * 100).toFixed(1);
                      return [
                        `${value.toLocaleString()} (${percentage}%)`,
                        props.payload.label,
                      ];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                    formatter={(value, entry: any) => {
                      const total = charts.genderSplit.reduce(
                        (sum, e) => sum + e.value,
                        0
                      );
                      const percentage = (
                        (entry.payload.value / total) *
                        100
                      ).toFixed(1);
                      return `${value}: ${percentage}%`;
                    }}
                    verticalAlign="bottom"
                    height={36}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Alert className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No data available for the selected date range. Please adjust
                  your filters or upload data for this period.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Subscription Type */}
        <Card>
          <CardHeader>
            <CardTitle>Subscription Types</CardTitle>
          </CardHeader>
          <CardContent>
            {charts?.subscriptionType && charts.subscriptionType.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={charts.subscriptionType}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={false}
                    outerRadius={100}
                    innerRadius={40}
                    fill="#8884d8"
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {charts.subscriptionType.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                        stroke="#ffffff"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      padding: "12px",
                    }}
                    labelStyle={{
                      color: "#111827",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                    formatter={(value: number, name: string, props: any) => {
                      const total = charts.subscriptionType.reduce(
                        (sum, e) => sum + e.value,
                        0
                      );
                      const percentage = ((value / total) * 100).toFixed(1);
                      return [
                        `${value.toLocaleString()} (${percentage}%)`,
                        props.payload.type,
                      ];
                    }}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                    formatter={(value, entry: any) => {
                      const total = charts.subscriptionType.reduce(
                        (sum, e) => sum + e.value,
                        0
                      );
                      const percentage = (
                        (entry.payload.value / total) *
                        100
                      ).toFixed(1);
                      return `${value}: ${percentage}%`;
                    }}
                    verticalAlign="bottom"
                    height={36}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <Alert className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No data available for the selected date range. Please adjust
                  your filters or upload data for this period.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        {/* Cohort Churn */}
        <Card>
          <CardHeader>
            <CardTitle>Cohort Churn</CardTitle>
          </CardHeader>
          <CardContent>
            {charts?.cohortChurn && charts.cohortChurn.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={charts.cohortChurn}
                  margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                >
                  <defs>
                    <linearGradient
                      id="churnGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.9} />
                      <stop
                        offset="95%"
                        stopColor="#dc2626"
                        stopOpacity={0.8}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e5e7eb"
                    opacity={0.4}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="cohort"
                    angle={-45}
                    textAnchor="end"
                    height={80}
                    tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
                    axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                    tickLine={{ stroke: "#d1d5db" }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#6b7280", fontSize: 11 }}
                    axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                    tickLine={{ stroke: "#d1d5db" }}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "white",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      padding: "12px",
                    }}
                    labelStyle={{
                      color: "#111827",
                      fontWeight: 600,
                      marginBottom: "4px",
                    }}
                    formatter={(value: number, name: string, props: any) => [
                      `${value.toFixed(2)}%`,
                      `Churn Rate (${props.payload.churned}/${props.payload.total})`,
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                  />
                  <Bar
                    dataKey="churnRate"
                    fill="url(#churnGradient)"
                    name="Churn Rate %"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={60}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Alert className="mb-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  No data available for the selected date range. Please adjust
                  your filters or upload data for this period.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
