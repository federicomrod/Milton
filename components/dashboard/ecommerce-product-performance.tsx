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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { DateRangePicker } from "@/components/dashboard/date-range-picker";

interface ProductEntry {
  name: string;
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPercent: number;
}

interface CategoryMargin {
  category: string;
  revenue: number;
  cost: number;
  margin: number;
  marginPercent: number;
}

interface EcommerceProductPerformanceProps {
  period: "month" | "year" | "ytd" | "custom";
  customDateRange: { from: string; to: string };
  onPeriodChange: (period: "month" | "year" | "ytd" | "custom") => void;
  onCustomDateRangeChange: (range: { from: string; to: string }) => void;
}

export function EcommerceProductPerformance({
  period,
  customDateRange,
  onPeriodChange,
  onCustomDateRangeChange,
}: EcommerceProductPerformanceProps) {
  const [productLeaderboard, setProductLeaderboard] = useState<ProductEntry[]>(
    []
  );
  const [categoryMargins, setCategoryMargins] = useState<CategoryMargin[]>([]);
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
        `/api/analytics/ecommerce/products?from_date=${fromDateStr}&to_date=${toDateStr}`,
        { cache: "no-store", credentials: "include" }
      );
      if (!response.ok) {
        throw new Error("Failed to fetch product performance data");
      }

      const data = await response.json();
      setProductLeaderboard(data.productLeaderboard || []);
      setCategoryMargins(data.categoryMargins || []);
    } catch (err) {
      console.error("Error fetching product performance:", err);
      setError("Failed to load product performance data");
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
              Loading product performance data...
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Margin by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryMargins.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryMargins}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === "marginPercent")
                        return `${value.toFixed(1)}%`;
                      return formatCurrency(value);
                    }}
                  />
                  <Bar dataKey="marginPercent" fill="#2563eb" name="Margin %" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No category data available
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {categoryMargins.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categoryMargins}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" />
                  <YAxis tickFormatter={(v) => `$${v}`} />
                  <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  <Bar dataKey="revenue" fill="#0088FE" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No category data available
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Product Profitability Leaderboard</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Sorted by margin % (highest first)
          </p>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Revenue</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Margin</TableHead>
                <TableHead>Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {productLeaderboard.length > 0 ? (
                productLeaderboard.map((p, index) => (
                  <TableRow key={index}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.category}</TableCell>
                    <TableCell>{formatCurrency(p.revenue)}</TableCell>
                    <TableCell>{formatCurrency(p.cost)}</TableCell>
                    <TableCell>{formatCurrency(p.margin)}</TableCell>
                    <TableCell
                      className={
                        p.marginPercent >= 0 ? "text-green-600" : "text-red-600"
                      }
                    >
                      {p.marginPercent.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
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
  );
}
