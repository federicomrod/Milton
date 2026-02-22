"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Database,
  Loader2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DataPreviewProps {
  tableName: string;
  onClose?: () => void;
}

interface TableData {
  rows: Record<string, any>[];
  columns: string[];
  pkColumns?: string[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

const PAGE_SIZE_OPTIONS = [25, 50, 100];

export default function DataPreview({ tableName, onClose }: DataPreviewProps) {
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const fetchData = async (page: number = 1, size: number = pageSize) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        tableName,
        page: page.toString(),
        pageSize: size.toString(),
      });

      const response = await fetch(`/api/data/table-preview?${params}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      console.error("Error fetching table data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(currentPage, pageSize);
  }, [tableName, currentPage, pageSize]);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newSize: string) => {
    const size = parseInt(newSize);
    setPageSize(size);
    setCurrentPage(1); // Reset to first page when changing page size
  };

  const formatCellValue = (value: any): string => {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (typeof value === "object") {
      return JSON.stringify(value);
    }
    return String(value);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Failed to load table data</p>
            <p className="text-sm text-red-600 mt-2">{error}</p>
            <Button
              variant="outline"
              onClick={() => fetchData(currentPage, pageSize)}
              className="mt-4"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="text-center">
            <Database className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No data found in this table</p>
            <p className="text-sm mt-2">
              Upload some data to see records here.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { rows, columns, pkColumns = [], pagination } = data;
  const pkSet = new Set(pkColumns);
  const startRow = (pagination.page - 1) * pagination.pageSize + 1;
  const endRow = Math.min(
    pagination.page * pagination.pageSize,
    pagination.totalCount
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Data Preview: {tableName}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Showing rows {startRow} to {endRow} of{" "}
              {pagination.totalCount.toLocaleString()} total rows
            </p>
          </div>
          <Badge variant="secondary">{columns.length} columns</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Pagination Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Show</span>
            <Select
              value={pageSize.toString()}
              onValueChange={handlePageSizeChange}
            >
              <SelectTrigger className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">rows per page</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(1)}
              disabled={!pagination.hasPrev}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(pagination.page - 1)}
              disabled={!pagination.hasPrev}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <span className="text-sm text-muted-foreground px-2">
              Page {pagination.page} of {pagination.totalPages}
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(pagination.page + 1)}
              disabled={!pagination.hasNext}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(pagination.totalPages)}
              disabled={!pagination.hasNext}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Data Table */}
        <div className="border rounded-md overflow-hidden">
          <div className="overflow-x-auto max-h-96">
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column}
                      className={`min-w-[120px] ${pkSet.has(column) ? "font-semibold bg-primary/5" : ""}`}
                    >
                      {column}
                      {pkSet.has(column) && (
                        <Badge
                          variant="outline"
                          className="ml-1.5 text-[10px] px-1 py-0 font-normal"
                        >
                          PK
                        </Badge>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, rowIdx) => (
                  <TableRow key={rowIdx}>
                    {columns.map((column) => (
                      <TableCell
                        key={column}
                        className={`max-w-[200px] ${pkSet.has(column) ? "font-mono text-xs bg-primary/5" : ""}`}
                      >
                        <div
                          className="truncate"
                          title={formatCellValue(row[column])}
                        >
                          {formatCellValue(row[column])}
                        </div>
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Bottom Pagination Info */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Showing {startRow} to {endRow} of{" "}
            {pagination.totalCount.toLocaleString()} entries
          </span>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close Preview
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
