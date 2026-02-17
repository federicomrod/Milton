"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  DollarSign,
  XCircle,
  Activity,
  TrendingUp,
  TrendingDown,
  Download,
  Clock,
} from "lucide-react";
import {
  getFitnessStudioKpis,
  getClassesUtilizationKpis,
  getApiFieldForKpi,
  type DatabaseKpi,
} from "@/lib/fitness-studio-kpis";
import { KpiCard } from "@/components/dashboard/kpi-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface KpiData {
  avgClassOccupancy: number;
  revenuePerClass: number;
  cancellationRate: number;
  capacityUtilization: number;
}

interface TrendData {
  avgClassOccupancy: number;
  revenuePerClass: number;
  cancellationRate: number;
}

interface TopPerformingClass {
  class_id: string;
  class_name: string;
  initials: string;
  instructor_name: string;
  schedule: string;
  occupancy: number;
  revenue: number;
  trend: "up" | "down";
}

interface OccupancyByType {
  class_type: string;
  occupancy: number;
}

interface ClassesUtilizationProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function ClassesUtilization({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: ClassesUtilizationProps) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [databaseKpis, setDatabaseKpis] = useState<DatabaseKpi[]>([]);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [topPerformingClasses, setTopPerformingClasses] = useState<
    TopPerformingClass[]
  >([]);
  const [occupancyByType, setOccupancyByType] = useState<OccupancyByType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Load database KPIs on mount
  useEffect(() => {
    const loadDatabaseKpis = async () => {
      const allKpis = await getFitnessStudioKpis();
      const classesKpis = getClassesUtilizationKpis(allKpis);
      setDatabaseKpis(classesKpis);
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
        // month
        fromDate.setMonth(fromDate.getMonth() - 1);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      const res = await fetch(
        `/api/analytics/fitness-studio/classes-utilization?from_date=${fromDateStr}&to_date=${toDateStr}&period=${period}`,
        { cache: "no-store", credentials: "include" }
      );

      const json = await res.json();

      setKpis(json.kpis || null);
      setTrends(json.trends || null);
      setTopPerformingClasses(json.topPerformingClasses || []);
      setOccupancyByType(json.occupancyByType || []);

      if (!json.kpis || Object.keys(json.kpis).length === 0) {
        setWarnings([
          "No data available. Please upload classes, bookings, and instructors data.",
        ]);
      }
    } catch (err) {
      console.error("Error loading classes & utilization data:", err);
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
            Loading classes & utilization data...
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
          <h2 className="text-2xl font-bold">Classes & Utilization</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track class performance, revenue metrics, and studio capacity
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

          // Debug log for Capacity Utilization
          if (
            dbKpi.name.includes("Capacity Utilization") ||
            dbKpi.name.includes("Table Utilization")
          ) {
            console.log(
              `[classes-utilization] KPI: ${dbKpi.name}, apiField: ${apiField}, value: ${value}, kpiValue: ${kpiValue}`
            );
          }

          // Get trend value if available
          const trendField = apiField as keyof TrendData;
          const trendValue = trends?.[trendField];

          // Determine formatting and icon based on KPI name
          let format: "number" | "percentage" | "currency" = "number";
          let icon = Users;
          let iconColor = "text-blue-600";
          let valueColor = "text-blue-600";
          let suffix = "";

          if (
            dbKpi.name.includes("Occupancy") ||
            dbKpi.name.includes("Attendance")
          ) {
            icon = Users;
            iconColor = "text-blue-600";
            valueColor = "text-blue-600";
            format = "percentage";
            suffix = "%";
          } else if (dbKpi.name.includes("Average Class Size")) {
            icon = Users;
            iconColor = "text-blue-600";
            valueColor = "text-blue-600";
            format = "number";
            suffix = "";
          } else if (dbKpi.name.includes("Revenue per Class")) {
            icon = DollarSign;
            iconColor = "text-green-600";
            valueColor = "text-green-600";
            format = "currency";
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
          }

          // Determine if trend should be shown (only for certain KPIs)
          const showTrend =
            trendValue !== undefined &&
            trendValue !== 0 &&
            (apiField === "avgClassOccupancy" ||
              apiField === "revenuePerClass" ||
              apiField === "cancellationRate");

          // Build trend description if available
          let trendDescription: string | undefined = undefined;
          if (showTrend) {
            if (apiField === "cancellationRate") {
              // For cancellation rate, negative trend is good
              trendDescription =
                trendValue! < 0
                  ? `↓ ${Math.abs(trendValue!).toFixed(1)}%`
                  : `↑ +${trendValue!.toFixed(1)}%`;
            } else {
              // For other KPIs, positive trend is good
              trendDescription =
                trendValue! > 0
                  ? `↑ +${trendValue!.toFixed(1)}%`
                  : `↓ ${trendValue!.toFixed(1)}%`;
            }
          }

          return (
            <KpiCard
              key={dbKpi.id}
              kpi={dbKpi}
              value={kpiValue}
              icon={icon}
              iconColor={iconColor}
              valueColor={valueColor}
              suffix={suffix}
              description={trendDescription}
              fetchFromApi={false}
            />
          );
        })}
      </div>

      {/* Occupancy by Class Type Chart */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Occupancy by Class Type</CardTitle>
            <Select defaultValue="all">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="All Locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Locations</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {occupancyByType.length === 0 && (
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
              data={occupancyByType}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e5e7eb"
                opacity={0.4}
              />
              <XAxis
                dataKey="class_type"
                angle={-45}
                textAnchor="end"
                height={80}
                tick={{ fill: "#6b7280", fontSize: 11, fontWeight: 500 }}
                axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#6b7280", fontSize: 11 }}
                axisLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                tickFormatter={(value) => `${value}%`}
              />
              <Tooltip
                formatter={(value: number) => `${value.toFixed(1)}%`}
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
              />
              <Bar dataKey="occupancy" radius={[8, 8, 0, 0]}>
                {occupancyByType.map((entry, index) => {
                  const colors = [
                    "#3b82f6", // blue
                    "#8b5cf6", // purple
                    "#ec4899", // pink
                    "#14b8a6", // teal
                    "#f59e0b", // orange
                    "#60a5fa", // light blue
                  ];
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={colors[index % colors.length]}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Performing Classes Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Top Performing Classes</CardTitle>
            <Button variant="ghost" size="sm" className="text-xs">
              View All
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {topPerformingClasses.length === 0 && (
            <Alert className="mb-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                No data available for the selected date range. Please adjust
                your filters or upload data for this period.
              </AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">CLASS NAME</TableHead>
                <TableHead>INSTRUCTOR & TIME</TableHead>
                <TableHead className="text-center">OCCUPANCY</TableHead>
                <TableHead className="text-right">REVENUE</TableHead>
                <TableHead className="text-center">TREND</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPerformingClasses.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground py-8"
                  >
                    No classes found for the selected date range
                  </TableCell>
                </TableRow>
              ) : (
                topPerformingClasses.map((classItem, index) => (
                  <TableRow key={classItem.class_id || index}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                          <span className="text-xs font-semibold text-blue-700">
                            {classItem.initials}
                          </span>
                        </div>
                        <span className="font-medium">
                          {classItem.class_name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span className="text-sm">
                          {classItem.instructor_name} • {classItem.schedule}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 max-w-[80px] bg-muted rounded-full h-2">
                          <div
                            className={`h-2 rounded-full ${
                              classItem.occupancy > 90
                                ? "bg-green-600"
                                : classItem.occupancy > 75
                                  ? "bg-green-500"
                                  : "bg-purple-500"
                            }`}
                            style={{
                              width: `${Math.min(classItem.occupancy, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="text-sm font-semibold w-12">
                          {classItem.occupancy.toFixed(0)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-green-600">
                      ${classItem.revenue.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      {classItem.trend === "up" ? (
                        <TrendingUp className="h-4 w-4 text-green-600 mx-auto" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600 mx-auto" />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
