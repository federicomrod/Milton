"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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

export function StudioPerformance() {
  const [kpis, setKpis] = useState<KpiData | null>(null);
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

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);
      setWarnings([]);

      try {
        const fromDate = new Date();
        fromDate.setMonth(fromDate.getMonth() - 6);
        const toDate = new Date();

        const fromDateStr = fromDate.toISOString().split("T")[0];
        const toDateStr = toDate.toISOString().split("T")[0];

        // Fetch KPIs
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

    loadData();
  }, []);

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

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Members
            </CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {kpis?.activeMembers?.toLocaleString() || "0"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Members active on the last day of the month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              New Members (Monthly)
            </CardTitle>
            <UserPlus className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {kpis?.newMembers?.toLocaleString() || "0"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              New members who joined this month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Churn Rate</CardTitle>
            <UserMinus
              className={`h-4 w-4 ${(kpis?.churnRate || 0) > 5 ? "text-red-600" : "text-orange-600"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${(kpis?.churnRate || 0) > 5 ? "text-red-600" : "text-orange-600"}`}
            >
              {kpis?.churnRate?.toFixed(1) || "0.0"}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Monthly churn rate percentage
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Member Tenure
            </CardTitle>
            <Clock className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {kpis?.avgTenure?.toFixed(1) || "0.0"} mo
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average tenure of active members
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Revenue per Member
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ${kpis?.revenuePerMember?.toFixed(2) || "0.00"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Average revenue per active member (ARPM)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Utilization Rate
            </CardTitle>
            <Activity
              className={`h-4 w-4 ${(kpis?.utilizationRate || 0) > 75 ? "text-green-600" : (kpis?.utilizationRate || 0) > 50 ? "text-yellow-600" : "text-orange-600"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${(kpis?.utilizationRate || 0) > 75 ? "text-green-600" : (kpis?.utilizationRate || 0) > 50 ? "text-yellow-600" : "text-orange-600"}`}
            >
              {kpis?.utilizationRate?.toFixed(1) || "0.0"}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Percentage of class capacity utilized
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Cancellation Rate
            </CardTitle>
            <XCircle
              className={`h-4 w-4 ${(kpis?.cancellationRate || 0) > 20 ? "text-red-600" : (kpis?.cancellationRate || 0) > 10 ? "text-orange-600" : "text-yellow-600"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${(kpis?.cancellationRate || 0) > 20 ? "text-red-600" : (kpis?.cancellationRate || 0) > 10 ? "text-orange-600" : "text-yellow-600"}`}
            >
              {kpis?.cancellationRate?.toFixed(1) || "0.0"}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Percentage of bookings cancelled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Chart 1: Members Over Time */}
        <Card>
          <CardHeader>
            <CardTitle>Members Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {memberCountData.length > 0 ? (
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
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart 2: New vs Churned Members */}
        <Card>
          <CardHeader>
            <CardTitle>New vs Churned Members</CardTitle>
          </CardHeader>
          <CardContent>
            {newVsChurnedData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={newVsChurnedData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="new_members"
                    fill="#10b981"
                    name="New Members"
                  />
                  <Bar
                    dataKey="churned_members"
                    fill="#ef4444"
                    name="Churned"
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart 3: Revenue per Member Trend */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue per Member Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {revenuePerMemberData.length > 0 ? (
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
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Chart 4: Utilization Heatmap */}
        <Card>
          <CardHeader>
            <CardTitle>Utilization Heatmap</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Peak hours and class popularity by time of day
            </p>
          </CardHeader>
          <CardContent>
            {heatmapData.length > 0 ? (
              <div className="overflow-x-auto">
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
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
