"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";

interface CoversByDay {
  day: string;
  covers: number;
  orders: number;
}

interface CoversByHour {
  hour: number;
  hourLabel: string;
  covers: number;
  orders: number;
}

interface PeakTime {
  hour: number;
  hourLabel: string;
  covers: number;
  orders: number;
}

interface TableUtilization {
  totalCapacity: number;
  totalCovers: number;
  utilizationPercent: number;
  averageOrdersPerDay: number;
  tableTurnover: number | null;
}

interface ReservationsEffectiveness {
  totalReservations: number;
  confirmedReservations: number;
  noShowReservations: number;
  noShowRate: number;
  matchedToOrders: number;
  conversionRate: number;
}

interface RestaurantOperationsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function RestaurantOperations({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: RestaurantOperationsProps) {
  const [coversByDay, setCoversByDay] = useState<CoversByDay[]>([]);
  const [coversByHour, setCoversByHour] = useState<CoversByHour[]>([]);
  const [peakTimes, setPeakTimes] = useState<PeakTime[]>([]);
  const [tableUtilization, setTableUtilization] =
    useState<TableUtilization | null>(null);
  const [reservationsEffectiveness, setReservationsEffectiveness] =
    useState<ReservationsEffectiveness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        `/api/analytics/restaurant/operations?from_date=${fromDateStr}&to_date=${toDateStr}&period=${period}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch operations data");
      }

      const data = await response.json();
      setCoversByDay(data.coversByDay || []);
      setCoversByHour(data.coversByHour || []);
      setPeakTimes(data.peakTimes || []);
      setTableUtilization(data.tableUtilization || null);
      setReservationsEffectiveness(data.reservationsEffectiveness || null);
    } catch (err) {
      console.error("Error fetching operations data:", err);
      setError("Failed to load operations data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [period, customDateRange]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">
              Loading operations data...
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

  return (
    <div className="space-y-4">
      {/* Period Selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <DateRangePicker
            period={period}
            customDateRange={customDateRange}
            onPeriodChange={onPeriodChange}
            onCustomDateRangeChange={onCustomDateRangeChange}
          />
        </div>
      </div>

      {/* Covers by Day */}
      <Card>
        <CardHeader>
          <CardTitle>Covers by Day of Week</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={coversByDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="covers" fill="#0088FE" name="Covers" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Covers by Hour */}
      <Card>
        <CardHeader>
          <CardTitle>Covers by Hour</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={coversByHour}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hourLabel" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="covers"
                stroke="#0088FE"
                strokeWidth={2}
                name="Covers"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Table Utilization */}
        <Card>
          <CardHeader>
            <CardTitle>Table Utilization</CardTitle>
          </CardHeader>
          <CardContent>
            {tableUtilization ? (
              <div className="space-y-4">
                <div>
                  <div className="text-2xl font-bold">
                    {tableUtilization.utilizationPercent.toFixed(1)}%
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Utilization Rate
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-lg font-semibold">
                      {tableUtilization.totalCapacity}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total Capacity
                    </p>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {tableUtilization.totalCovers}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Total Covers
                    </p>
                  </div>
                  <div>
                    <div className="text-lg font-semibold">
                      {tableUtilization.averageOrdersPerDay.toFixed(1)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Avg Orders/Day
                    </p>
                  </div>
                  {tableUtilization.tableTurnover !== null && (
                    <div>
                      <div className="text-lg font-semibold">
                        {tableUtilization.tableTurnover.toFixed(1)}%
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Table Turnover
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                No table data available
              </div>
            )}
          </CardContent>
        </Card>

        {/* Peak Times */}
        <Card>
          <CardHeader>
            <CardTitle>Peak Times</CardTitle>
          </CardHeader>
          <CardContent>
            {peakTimes.length > 0 ? (
              <div className="space-y-2">
                {peakTimes.map((peak, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-2 border rounded"
                  >
                    <div>
                      <div className="font-medium">{peak.hourLabel}</div>
                      <div className="text-sm text-muted-foreground">
                        {peak.covers} covers, {peak.orders} orders
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground">
                No peak time data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Reservations Effectiveness */}
      {reservationsEffectiveness && (
        <Card>
          <CardHeader>
            <CardTitle>Reservations Effectiveness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <div className="text-2xl font-bold">
                  {reservationsEffectiveness.totalReservations}
                </div>
                <p className="text-sm text-muted-foreground">
                  Total Reservations
                </p>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {reservationsEffectiveness.confirmedReservations}
                </div>
                <p className="text-sm text-muted-foreground">Confirmed</p>
              </div>
              <div>
                <div className="text-2xl font-bold text-red-600">
                  {reservationsEffectiveness.noShowRate.toFixed(1)}%
                </div>
                <p className="text-sm text-muted-foreground">No-Show Rate</p>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {reservationsEffectiveness.matchedToOrders}
                </div>
                <p className="text-sm text-muted-foreground">
                  Matched to Orders
                </p>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-600">
                  {reservationsEffectiveness.conversionRate.toFixed(1)}%
                </div>
                <p className="text-sm text-muted-foreground">Conversion Rate</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
