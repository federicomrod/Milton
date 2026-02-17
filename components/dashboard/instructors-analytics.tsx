"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import {
  DollarSign,
  Users,
  Calendar,
  XCircle,
  TrendingUp,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/dashboard/kpi-card";
import type { DatabaseKpi } from "@/lib/types/kpi";

interface InstructorsAnalyticsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

interface KpiData {
  revenuePerInstructor: number;
  avgClassOccupancy: number;
  classesTaught: number;
  cancellationRate: number;
}

interface InstructorRanking {
  instructor_id: string;
  name: string;
  revenue: number;
  revenueMetric: number;
  classesTaught: number;
  avgOccupancy: number;
  cancellationRate: number;
  totalBookings: number;
  attendedBookings: number;
  hasRevenueData: boolean;
}

interface ChartDataPoint {
  name: string;
  classes: number;
  type: string;
}

const COLORS = {
  primary: "#8B5CF6", // Purple
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  blue: "#3B82F6",
  pink: "#EC4899",
};

const CHART_COLORS = {
  top: "#8B5CF6", // Purple for top 5
  bottom: "#94A3B8", // Gray for bottom 5
};

export function InstructorsAnalytics({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: InstructorsAnalyticsProps) {
  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [rankings, setRankings] = useState<InstructorRanking[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [hasRevenueData, setHasRevenueData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInstructor, setSelectedInstructor] = useState<string | null>(
    null
  );
  const [sortColumn, setSortColumn] = useState<
    "name" | "revenue" | "classes" | "occupancy" | "cancellation"
  >("revenue");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

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
        // month
        fromDate.setMonth(fromDate.getMonth() - 1);
      }

      const fromDateStr = fromDate.toISOString().split("T")[0];
      const toDateStr = toDate.toISOString().split("T")[0];

      const response = await fetch(
        `/api/analytics/fitness-studio/instructors?from_date=${fromDateStr}&to_date=${toDateStr}`,
        { cache: "no-store", credentials: "include" }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch instructors analytics data");
      }

      const json = await response.json();
      setKpis(json.kpis || null);
      setRankings(json.rankings || []);
      setChartData(json.chartData || []);
      setHasRevenueData(json.hasRevenueData || false);
    } catch (err) {
      console.error("Error loading instructors analytics data:", err);
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
            Loading instructors analytics data...
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

  const selectedInstructorData = selectedInstructor
    ? rankings.find((r) => r.instructor_id === selectedInstructor)
    : null;

  // Sort rankings based on selected column and direction
  const sortedRankings = [...rankings].sort((a, b) => {
    let comparison = 0;

    switch (sortColumn) {
      case "name":
        comparison = a.name.localeCompare(b.name);
        break;
      case "revenue":
        comparison =
          (hasRevenueData ? a.revenue : a.attendedBookings) -
          (hasRevenueData ? b.revenue : b.attendedBookings);
        break;
      case "classes":
        comparison = a.classesTaught - b.classesTaught;
        break;
      case "occupancy":
        comparison = a.avgOccupancy - b.avgOccupancy;
        break;
      case "cancellation":
        comparison = a.cancellationRate - b.cancellationRate;
        break;
    }

    return sortDirection === "asc" ? comparison : -comparison;
  });

  const handleSort = (column: typeof sortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if clicking the same column
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new column and default to descending
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ column }: { column: typeof sortColumn }) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    }
    return sortDirection === "asc" ? (
      <ArrowUp className="h-3 w-3 ml-1" />
    ) : (
      <ArrowDown className="h-3 w-3 ml-1" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header with filters */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Instructors</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Track instructor performance, revenue metrics, and class capacity.
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
      <div className="grid gap-4 md:grid-cols-4">
        <KpiCard
          kpi={{
            id: "revenue-per-instructor",
            name: "Revenue per Instructor",
            definition: "Average revenue generated per instructor",
          }}
          value={kpis?.revenuePerInstructor || 0}
          icon={DollarSign}
          iconColor="text-green-600"
          valueColor="text-green-600"
          description={
            !hasRevenueData ? "Using attendance as fallback" : undefined
          }
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "avg-class-occupancy",
            name: "Avg. Class Occupancy",
            definition: "Average class occupancy percentage",
          }}
          value={kpis?.avgClassOccupancy || 0}
          icon={Users}
          iconColor="text-purple-600"
          valueColor="text-purple-600"
          suffix="%"
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "classes-taught",
            name: "Classes Taught",
            definition: "Total number of classes taught",
          }}
          value={kpis?.classesTaught || 0}
          icon={Calendar}
          iconColor="text-blue-600"
          valueColor="text-blue-600"
          fetchFromApi={false}
        />

        <KpiCard
          kpi={{
            id: "cancellation-rate",
            name: "Cancellation Rate",
            definition: "Percentage of cancelled bookings",
          }}
          value={kpis?.cancellationRate || 0}
          icon={XCircle}
          iconColor="text-red-600"
          valueColor="text-red-600"
          suffix="%"
          fetchFromApi={false}
        />
      </div>

      {/* Ranking Table */}
      <Card>
        <CardHeader>
          <CardTitle>Instructor Rankings</CardTitle>
          <p className="text-sm text-muted-foreground">
            Performance based on revenue and class occupancy
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("name")}
                  >
                    <div className="flex items-center">
                      Instructor
                      <SortIcon column="name" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("revenue")}
                  >
                    <div className="flex items-center">
                      {hasRevenueData ? "Revenue" : "Attendances"}
                      <SortIcon column="revenue" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("classes")}
                  >
                    <div className="flex items-center">
                      Classes
                      <SortIcon column="classes" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("occupancy")}
                  >
                    <div className="flex items-center">
                      Occupancy
                      <SortIcon column="occupancy" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleSort("cancellation")}
                  >
                    <div className="flex items-center">
                      Cancellation Rate
                      <SortIcon column="cancellation" />
                    </div>
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRankings.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-muted-foreground"
                    >
                      No instructor data available
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedRankings.map((instructor, index) => {
                    const isTopPerformer =
                      index < 3 && instructor.avgOccupancy >= 80;
                    const isOnTrack =
                      !isTopPerformer && instructor.avgOccupancy >= 70;

                    return (
                      <TableRow
                        key={instructor.instructor_id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          setSelectedInstructor(
                            selectedInstructor === instructor.instructor_id
                              ? null
                              : instructor.instructor_id
                          )
                        }
                      >
                        <TableCell className="font-medium">
                          {instructor.name}
                        </TableCell>
                        <TableCell>
                          {hasRevenueData
                            ? `$${instructor.revenue.toLocaleString()}`
                            : instructor.attendedBookings}
                        </TableCell>
                        <TableCell>{instructor.classesTaught}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress
                              value={instructor.avgOccupancy}
                              className="w-20"
                            />
                            <span className="text-sm">
                              {instructor.avgOccupancy.toFixed(1)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>
                          {instructor.cancellationRate.toFixed(1)}%
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              isTopPerformer
                                ? "default"
                                : isOnTrack
                                  ? "secondary"
                                  : "outline"
                            }
                            className={
                              isTopPerformer
                                ? "bg-green-500"
                                : isOnTrack
                                  ? "bg-blue-500"
                                  : ""
                            }
                          >
                            {isTopPerformer
                              ? "Top Perf"
                              : isOnTrack
                                ? "On Track"
                                : "Needs Attention"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Instructor Detail (Drill-down) */}
          {selectedInstructorData && (
            <div className="mt-4 p-4 border rounded-lg bg-muted/50">
              <h3 className="font-semibold mb-3">
                {selectedInstructorData.name} - Details
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total Bookings
                  </p>
                  <p className="text-lg font-semibold">
                    {selectedInstructorData.totalBookings}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Attended Bookings
                  </p>
                  <p className="text-lg font-semibold">
                    {selectedInstructorData.attendedBookings}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    {hasRevenueData ? "Revenue" : "Attendances"}
                  </p>
                  <p className="text-lg font-semibold">
                    {hasRevenueData
                      ? `$${selectedInstructorData.revenue.toLocaleString()}`
                      : selectedInstructorData.attendedBookings}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">
                    Avg. Occupancy
                  </p>
                  <p className="text-lg font-semibold">
                    {selectedInstructorData.avgOccupancy.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Chart: Classes per Instructor (Top 5 and Bottom 5) */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Classes Taught per Instructor</CardTitle>
            <p className="text-sm text-muted-foreground">
              Monthly volume comparison
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  angle={-45}
                  textAnchor="end"
                  height={100}
                />
                <YAxis />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                  }}
                />
                <Legend />
                <Bar dataKey="classes" name="Classes Taught">
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={
                        entry.type === "Top 5"
                          ? CHART_COLORS.top
                          : CHART_COLORS.bottom
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
