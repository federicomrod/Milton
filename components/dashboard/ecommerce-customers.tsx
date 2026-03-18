"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";

interface PeriodCount {
  period: string;
  count: number;
}

interface ChannelBreakdown {
  channel: string;
  count: number;
  percentage: number;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

interface EcommerceCustomersProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function EcommerceCustomers({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: EcommerceCustomersProps) {
  const [newCustomersByPeriod, setNewCustomersByPeriod] = useState<
    PeriodCount[]
  >([]);
  const [acquisitionChannelBreakdown, setAcquisitionChannelBreakdown] =
    useState<ChannelBreakdown[]>([]);
  const [totalNewCustomers, setTotalNewCustomers] = useState(0);
  const [repeatCustomerCount, setRepeatCustomerCount] = useState(0);
  const [totalCustomersWithOrders, setTotalCustomersWithOrders] = useState(0);
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

      const response = await fetch(
        `/api/analytics/ecommerce/customers?from_date=${fromDateStr}&to_date=${toDateStr}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch customer data");
      }

      const data = await response.json();
      setNewCustomersByPeriod(data.newCustomersByPeriod || []);
      setAcquisitionChannelBreakdown(data.acquisitionChannelBreakdown || []);
      setTotalNewCustomers(data.totalNewCustomers ?? 0);
      setRepeatCustomerCount(data.repeatCustomerCount ?? 0);
      setTotalCustomersWithOrders(data.totalCustomersWithOrders ?? 0);
    } catch (err) {
      console.error("Error fetching customer data:", err);
      setError("Failed to load customer data");
    } finally {
      setLoading(false);
    }
  }, [period, customDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const repeatRate =
    totalCustomersWithOrders > 0
      ? ((repeatCustomerCount / totalCustomersWithOrders) * 100).toFixed(1)
      : "0";

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">
              Loading customer data...
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
      <div className="flex items-center justify-between">
        <DateRangePicker
          period={period}
          customDateRange={customDateRange}
          onPeriodChange={onPeriodChange}
          onCustomDateRangeChange={onCustomDateRangeChange}
        />
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              New Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalNewCustomers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Repeat Customers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{repeatCustomerCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Repeat Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{repeatRate}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New Customers Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            {newCustomersByPeriod.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={newCustomersByPeriod}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#00C49F" name="New Customers" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No new customer data available
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Acquisition by Channel</CardTitle>
          </CardHeader>
          <CardContent>
            {acquisitionChannelBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={
                      acquisitionChannelBreakdown as unknown as Array<
                        Record<string, string | number>
                      >
                    }
                    dataKey="count"
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
                    {acquisitionChannelBreakdown.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => `${v} customers`} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No acquisition channel data available. Ensure your Customers
                table has an &quot;Acquisition Channel&quot; column.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
