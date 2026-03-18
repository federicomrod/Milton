"use client";

import { useState, useEffect, useCallback } from "react";
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

interface SalesTrend {
  date: string;
  revenue: number;
  orders: number;
}

interface CategoryBreakdown {
  category: string;
  revenue: number;
  percentage: number;
}

interface ProductItem {
  name: string;
  revenue: number;
  quantity: number;
  cost: number;
  margin: number | null;
  marginPercent: number | null;
  revenueShare: number;
}

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884d8"];

interface EcommerceRevenueProductsProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function EcommerceRevenueProducts({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: EcommerceRevenueProductsProps) {
  const [salesTrends, setSalesTrends] = useState<SalesTrend[]>([]);
  const [categoryBreakdown, setCategoryBreakdown] = useState<
    CategoryBreakdown[]
  >([]);
  const [topProducts, setTopProducts] = useState<ProductItem[]>([]);
  const [bottomProducts, setBottomProducts] = useState<ProductItem[]>([]);
  const [orderCount, setOrderCount] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [averageOrderValue, setAverageOrderValue] = useState(0);
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
        `/api/analytics/ecommerce/revenue-products?from_date=${fromDateStr}&to_date=${toDateStr}&period=${period}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch revenue & products data");
      }

      const data = await response.json();
      setSalesTrends(data.salesTrends || []);
      setCategoryBreakdown(data.categoryBreakdown || []);
      setTopProducts(data.topProducts || []);
      setBottomProducts(data.bottomProducts || []);
      setOrderCount(data.orderCount ?? 0);
      setTotalRevenue(data.totalRevenue ?? 0);
      setAverageOrderValue(data.averageOrderValue ?? 0);
    } catch (err) {
      console.error("Error fetching revenue & products data:", err);
      setError("Failed to load revenue & products data");
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

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-sm text-muted-foreground">
              Loading revenue & products data...
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
              Total Revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(totalRevenue)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orderCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Average Order Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(averageOrderValue)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sales Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Sales Trends</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={salesTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis tickFormatter={(value) => `$${value}`} />
              <Tooltip
                formatter={(value: number) => formatCurrency(value)}
                labelFormatter={(label) => {
                  const date = new Date(label);
                  return date.toLocaleDateString();
                }}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#0088FE"
                strokeWidth={2}
                name="Revenue"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={
                    categoryBreakdown as unknown as Array<
                      Record<string, string | number>
                    >
                  }
                  dataKey="revenue"
                  nameKey="category"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={
                    ((props: Record<string, unknown>) => {
                      const category = props.category as string;
                      const percentage = props.percentage as number;
                      return `${category}: ${percentage.toFixed(1)}%`;
                    }) as unknown as (props: unknown) => string
                  }
                >
                  {categoryBreakdown.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={salesTrends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis />
                <Tooltip />
                <Bar dataKey="orders" fill="#00C49F" name="Orders" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top & Bottom Products */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Performing Products</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Share</TableHead>
                  {topProducts.some((item) => item.margin !== null) && (
                    <TableHead>Margin</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {topProducts.length > 0 ? (
                  topProducts.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{formatCurrency(item.revenue)}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.revenueShare.toFixed(1)}%</TableCell>
                      {item.margin !== null && (
                        <TableCell>
                          {item.marginPercent !== null
                            ? `${item.marginPercent.toFixed(1)}%`
                            : "N/A"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      No product data available
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Bottom Performing Products</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Revenue</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Share</TableHead>
                  {bottomProducts.some((item) => item.margin !== null) && (
                    <TableHead>Margin</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {bottomProducts.length > 0 ? (
                  bottomProducts.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{formatCurrency(item.revenue)}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.revenueShare.toFixed(1)}%</TableCell>
                      {item.margin !== null && (
                        <TableCell>
                          {item.marginPercent !== null
                            ? `${item.marginPercent.toFixed(1)}%`
                            : "N/A"}
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="text-center text-muted-foreground"
                    >
                      No product data available
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
