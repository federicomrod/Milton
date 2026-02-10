"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  Cell,
} from "recharts";
import {
  Users,
  UserPlus,
  UserMinus,
  Clock,
  DollarSign,
  Activity,
  XCircle,
  AlertTriangle,
  Download,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  getFitnessStudioKpis,
  getStudioPerformanceKpis,
  getApiFieldForKpi,
  type DatabaseKpi,
} from "@/lib/fitness-studio-kpis";

interface KpiData {
  activeMembers: number;
  newMembers: number;
  churnedMembers: number;
  churnRate: number;
  avgTenure: number;
  revenuePerMember: number;
  utilizationRate: number;
  cancellationRate: number;
}

interface ChartDataPoint {
  period: string;
  value?: number;
  new_members?: number;
  churned_members?: number;
  weekday_iso?: number;
  hour_of_day?: number;
  utilization?: number;
}

const WEEKDAY_LABELS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface StudioPerformanceProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function StudioPerformance({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: StudioPerformanceProps) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [databaseKpis, setDatabaseKpis] = useState<DatabaseKpi[]>([]);
  const [memberCountData, setMemberCountData] = useState<ChartDataPoint[]>([]);
  const [newVsChurnedData, setNewVsChurnedData] = useState<ChartDataPoint[]>(
    []
  );
  const [revenuePerMemberData, setRevenuePerMemberData] = useState<
    ChartDataPoint[]
  >([]);
  const [heatmapData, setHeatmapData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Load database KPIs on mount
  useEffect(() => {
    const loadDatabaseKpis = async () => {
      const allKpis = await getFitnessStudioKpis();
      const studioKpis = getStudioPerformanceKpis(allKpis);
      setDatabaseKpis(studioKpis);
    };
    loadDatabaseKpis();
  }, []);

  useEffect(() => {
    loadData();
  }, [period, customDateRange]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    setWarnings([]);

    try {
      let toDate = new Date();
      let fromDate = new Date();

      if (period === "year") {
        fromDate = new Date(new Date().getFullYear() - 1, 0, 1); // January 1st of last year
        toDate = new Date(new Date().getFullYear() - 1, 11, 31, 23, 59, 59); // December 31st of last year
      } else if (period === "ytd") {
        fromDate = new Date(new Date().getFullYear(), 0, 1); // January 1st of current year
      } else if (period === "custom") {
        fromDate = new Date(customDateRange.from);
        toDate = new Date(customDateRange.to);
      } else {
        // month - default to last 6 months for charts, last month for KPIs
        fromDate.setMonth(fromDate.getMonth() - 6);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      // Fetch KPIs using the selected date range
      const kpisRes = await fetch(
        `/api/analytics/fitness-studio/kpis?from_date=${fromDateStr}&to_date=${toDateStr}`,
        { cache: "no-store", credentials: "include" }
      );
      const kpisJson = await kpisRes.json();
      setKpis(kpisJson.kpis || null);

      if (!kpisJson.kpis || Object.keys(kpisJson.kpis).length === 0) {
        setWarnings([
          "No KPI data available. Please upload members, bookings, and transactions data.",
        ]);
      }

      // Fetch charts
      const charts = [
        { type: "member-count", setter: setMemberCountData },
        { type: "new-vs-churned", setter: setNewVsChurnedData },
        { type: "revenue-per-member", setter: setRevenuePerMemberData },
        { type: "utilization-heatmap", setter: setHeatmapData },
      ];

      for (const chart of charts) {
        const chartRes = await fetch(
          `/api/analytics/fitness-studio/charts?chart=${chart.type}&from_date=${fromDateStr}&to_date=${toDateStr}`,
          { cache: "no-store", credentials: "include" }
        );
        const chartJson = await chartRes.json();
        chart.setter(chartJson.data || []);
      }
    } catch (err) {
      console.error("Error loading studio performance data:", err);
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
            Loading studio performance data...
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

  // Prepare heatmap data for visualization
  const heatmapMatrix: number[][] = Array(7)
    .fill(null)
    .map(() => Array(24).fill(0));

  heatmapData.forEach((point) => {
    if (
      point.weekday_iso &&
      point.hour_of_day !== undefined &&
      point.utilization !== undefined
    ) {
      const day = point.weekday_iso - 1; // Convert 1-7 to 0-6
      const hour = point.hour_of_day;
      if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
        heatmapMatrix[day][hour] = point.utilization;
      }
    }
  });

  const maxUtilization = Math.max(...heatmapMatrix.flat(), 1);

  const getHeatmapColor = (value: number) => {
    const intensity = value / maxUtilization;
    if (intensity === 0) return "#f3f4f6";
    if (intensity < 0.3) return "#ddd6fe";
    if (intensity < 0.6) return "#c4b5fd";
    if (intensity < 0.8) return "#a78bfa";
    return "#8b5cf6";
  };

  return (
    <div className="space-y-6">
      {warnings.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Studio Performance</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track member metrics, revenue, and studio utilization
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DateRangePicker
            period={period}
            customDateRange={customDateRange}
            onPeriodChange={onPeriodChange}
            onCustomDateRangeChange={onCustomDateRangeChange}
          />
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {databaseKpis.map((dbKpi) => {
          const apiField = getApiFieldForKpi(dbKpi.name);
          if (!apiField) return null;

          const value = (kpis as any)?.[apiField];
          const kpiValue = value !== undefined && value !== null ? value : 0;

          // Determine formatting and icon based on KPI name
          let format: "number" | "percentage" | "currency" | "months" =
            "number";
          let icon = Users;
          let iconColor = "text-blue-600";
          let valueColor = "text-blue-600";
          let suffix = "";

          if (dbKpi.name.includes("Active Members")) {
            icon = Users;
            iconColor = "text-blue-600";
            valueColor = "text-blue-600";
            format = "number";
          } else if (dbKpi.name.includes("New Members")) {
            icon = UserPlus;
            iconColor = "text-green-600";
            valueColor = "text-green-600";
            format = "number";
          } else if (dbKpi.name.includes("Churn Rate")) {
            icon = UserMinus;
            iconColor = kpiValue > 5 ? "text-red-600" : "text-orange-600";
            valueColor = kpiValue > 5 ? "text-red-600" : "text-orange-600";
            format = "percentage";
            suffix = "%";
          } else if (dbKpi.name.includes("Member Tenure")) {
            icon = Clock;
            iconColor = "text-purple-600";
            valueColor = "text-purple-600";
            format = "months";
            suffix = " mo";
          } else if (dbKpi.name.includes("Revenue per Member")) {
            icon = DollarSign;
            iconColor = "text-green-600";
            valueColor = "text-green-600";
            format = "currency";
          } else if (
            dbKpi.name.includes("Utilization") ||
            dbKpi.name.includes("Capacity")
          ) {
            icon = Activity;
            iconColor =
              kpiValue > 75
                ? "text-green-600"
                : kpiValue > 50
                  ? "text-yellow-600"
                  : "text-orange-600";
            valueColor =
              kpiValue > 75
                ? "text-green-600"
                : kpiValue > 50
                  ? "text-yellow-600"
                  : "text-orange-600";
            format = "percentage";
            suffix = "%";
          } else if (dbKpi.name.includes("Cancellation")) {
            icon = XCircle;
            iconColor =
              kpiValue > 20
                ? "text-red-600"
                : kpiValue > 10
                  ? "text-orange-600"
                  : "text-yellow-600";
            valueColor =
              kpiValue > 20
                ? "text-red-600"
                : kpiValue > 10
                  ? "text-orange-600"
                  : "text-yellow-600";
            format = "percentage";
            suffix = "%";
          }

          const IconComponent = icon;

          // Format the value
          let formattedValue = "0";
          if (format === "number") {
            formattedValue = kpiValue.toLocaleString();
          } else if (format === "percentage") {
            formattedValue = kpiValue.toFixed(1);
          } else if (format === "currency") {
            formattedValue = `$${kpiValue.toFixed(2)}`;
          } else if (format === "months") {
            formattedValue = kpiValue.toFixed(1);
          }

          return (
            <Card key={dbKpi.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {dbKpi.name
                    .replace(" (End of Month)", "")
                    .replace(" (ARPM)", "")}
                </CardTitle>
                <IconComponent className={`h-4 w-4 ${iconColor}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${valueColor}`}>
                  {formattedValue}
                  {format !== "currency" && suffix}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {dbKpi.definition}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Left Column: Three charts stacked */}
        <div className="space-y-4">
          {/* Chart 1: Members Over Time */}
          <Card>
            <CardHeader>
              <CardTitle>Members Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              {memberCountData.length === 0 && (
                <Alert className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No data available for the selected date range. Please adjust
                    your filters or upload data for this period.
                  </AlertDescription>
                </Alert>
              )}
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={memberCountData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: "#3b82f6", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart 2: New vs Churned Members */}
          <Card>
            <CardHeader>
              <CardTitle>New vs Churned Members</CardTitle>
            </CardHeader>
            <CardContent>
              {newVsChurnedData.length === 0 && (
                <Alert className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No data available for the selected date range. Please adjust
                    your filters or upload data for this period.
                  </AlertDescription>
                </Alert>
              )}
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={newVsChurnedData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                >
                  <defs>
                    <linearGradient
                      id="newMembersGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.9} />
                      <stop
                        offset="95%"
                        stopColor="#059669"
                        stopOpacity={0.8}
                      />
                    </linearGradient>
                    <linearGradient
                      id="churnedMembersGradient"
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
                    dataKey="period"
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
                    formatter={(value: number, name: string) => [
                      value.toLocaleString(),
                      name === "new_members"
                        ? "New Members"
                        : "Churned Members",
                    ]}
                  />
                  <Legend
                    wrapperStyle={{ paddingTop: "20px" }}
                    iconType="circle"
                    formatter={(value) => {
                      if (value === "new_members") return "New Members";
                      if (value === "churned_members") return "Churned Members";
                      return value;
                    }}
                  />
                  <Bar
                    dataKey="new_members"
                    fill="url(#newMembersGradient)"
                    name="New Members"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={60}
                  />
                  <Bar
                    dataKey="churned_members"
                    fill="url(#churnedMembersGradient)"
                    name="Churned Members"
                    radius={[8, 8, 0, 0]}
                    maxBarSize={60}
                  />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Chart 3: Revenue per Member Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue per Member Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {revenuePerMemberData.length === 0 && (
                <Alert className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No data available for the selected date range. Please adjust
                    your filters or upload data for this period.
                  </AlertDescription>
                </Alert>
              )}
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenuePerMemberData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number) => `$${value.toFixed(2)}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#8b5cf6"
                    strokeWidth={2}
                    dot={{ fill: "#8b5cf6", r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Utilization Heatmap */}
        <div className="flex">
          <Card className="w-full flex flex-col">
            <CardHeader className="pb-3">
              <CardTitle>Utilization Heatmap</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Peak hours and class popularity by time of day
              </p>
            </CardHeader>
            <CardContent className="pt-0 pb-4">
              {heatmapData.length === 0 && (
                <Alert className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No data available for the selected date range. Please adjust
                    your filters or upload data for this period.
                  </AlertDescription>
                </Alert>
              )}
              <div className="overflow-x-auto w-full">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="p-2 text-xs text-muted-foreground">
                        Time
                      </th>
                      {WEEKDAY_LABELS.slice(1).map((day) => (
                        <th
                          key={day}
                          className="p-2 text-xs text-muted-foreground"
                        >
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {HOURS.map((hour) => (
                      <tr key={hour}>
                        <td className="p-2 text-xs font-medium text-muted-foreground">
                          {hour.toString().padStart(2, "0")}:00
                        </td>
                        {WEEKDAY_LABELS.slice(1).map((_, dayIndex) => {
                          const day = dayIndex + 1;
                          const value = heatmapMatrix[dayIndex][hour];
                          return (
                            <td
                              key={`${day}-${hour}`}
                              className="p-2 text-center text-xs border"
                              style={{
                                backgroundColor: getHeatmapColor(value),
                                color:
                                  value > maxUtilization * 0.5
                                    ? "white"
                                    : "black",
                              }}
                              title={`${WEEKDAY_LABELS[day]} ${hour.toString().padStart(2, "0")}:00 - ${value.toFixed(0)}%`}
                            >
                              {value > 0 ? `${value.toFixed(0)}%` : ""}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
