"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { TrendingUp, TrendingDown, DollarSign, Clock } from "lucide-react";

interface CashFlowItem {
  category: string;
  amount: number;
}

interface RestaurantCashFlowProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function RestaurantCashFlow({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: RestaurantCashFlowProps) {
  const [inflows, setInflows] = useState<CashFlowItem[]>([]);
  const [outflows, setOutflows] = useState<CashFlowItem[]>([]);
  const [netCashFlow, setNetCashFlow] = useState<number>(0);
  const [burnRate, setBurnRate] = useState<number | null>(null);
  const [cashBalance, setCashBalance] = useState<number | null>(null);
  const [cashRunway, setCashRunway] = useState<number | null>(null);
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
        `/api/analytics/restaurant/cash-flow?from_date=${fromDateStr}&to_date=${toDateStr}&period=${period}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch cash flow data");
      }

      const data = await response.json();
      setInflows(data.inflows || []);
      setOutflows(data.outflows || []);
      setNetCashFlow(data.netCashFlow || 0);
      setBurnRate(data.burnRate || null);
      setCashBalance(data.cashBalance || null);
      setCashRunway(data.cashRunway || null);
    } catch (err) {
      console.error("Error fetching cash flow data:", err);
      setError("Failed to load cash flow data");
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

  // Prepare data for chart
  const chartData = [
    {
      category: "Inflows",
      amount: inflows.reduce((sum, item) => sum + item.amount, 0),
    },
    {
      category: "Outflows",
      amount: Math.abs(outflows.reduce((sum, item) => sum + item.amount, 0)),
    },
    {
      category: "Net Cash Flow",
      amount: netCashFlow,
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">
              Loading cash flow data...
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

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Cash Flow</CardTitle>
            {netCashFlow >= 0 ? (
              <TrendingUp className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                netCashFlow >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {formatCurrency(netCashFlow)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Inflows - Outflows
            </p>
          </CardContent>
        </Card>

        {burnRate !== null && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Burn Rate</CardTitle>
              <TrendingDown className="h-4 w-4 text-orange-600" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {formatCurrency(burnRate)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Per month</p>
            </CardContent>
          </Card>
        )}

        {cashBalance !== null && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Cash Balance
              </CardTitle>
              <DollarSign
                className={`h-4 w-4 ${
                  cashBalance > 50000
                    ? "text-green-600"
                    : cashBalance > 20000
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  cashBalance > 50000
                    ? "text-green-600"
                    : cashBalance > 20000
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              >
                {formatCurrency(cashBalance)}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Current balance
              </p>
            </CardContent>
          </Card>
        )}

        {cashRunway !== null && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cash Runway</CardTitle>
              <Clock
                className={`h-4 w-4 ${
                  cashRunway > 6
                    ? "text-green-600"
                    : cashRunway > 3
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  cashRunway > 6
                    ? "text-green-600"
                    : cashRunway > 3
                      ? "text-yellow-600"
                      : "text-red-600"
                }`}
              >
                {cashRunway} months
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Until cash runs out
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cash Flow Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Cash Flow Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Bar dataKey="amount">
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={
                      entry.category === "Net Cash Flow"
                        ? entry.amount >= 0
                          ? "#00C49F"
                          : "#FF8042"
                        : entry.category === "Inflows"
                          ? "#00C49F"
                          : "#FF8042"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Inflows */}
        <Card>
          <CardHeader>
            <CardTitle>Inflows by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inflows.length > 0 ? (
                  inflows.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {item.category}
                      </TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-muted-foreground"
                    >
                      No inflow data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Outflows */}
        <Card>
          <CardHeader>
            <CardTitle>Outflows by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outflows.length > 0 ? (
                  outflows.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">
                        {item.category}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatCurrency(item.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={2}
                      className="text-center text-muted-foreground"
                    >
                      No outflow data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
