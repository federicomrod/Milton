"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Database, Upload, CheckCircle2, Files } from "lucide-react";
import { ModelProposal, getTableDisplayName } from "@/lib/model/transform";
import ModelTableDetailView from "./ModelTableDetailView";
import MultiFileUploadView from "./MultiFileUploadView";

interface ModelTableListViewProps {
  model: ModelProposal | null;
  onTableSelect?: (tableName: string) => void;
}

export default function ModelTableListView({
  model,
  onTableSelect,
}: ModelTableListViewProps) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [showMultiUpload, setShowMultiUpload] = useState(false);
  const [tableDataCounts, setTableDataCounts] = useState<
    Record<string, number>
  >({});

  const fetchCounts = useCallback(async () => {
    if (!model?.recommendedTables) return;
    try {
      const response = await fetch("/api/data/sources", {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        setTableDataCounts({});
        return;
      }
      const data = await response.json();
      if (!data.dataSources || !Array.isArray(data.dataSources)) {
        setTableDataCounts({});
        return;
      }
      const modelTableNames = new Set(
        model.recommendedTables.map((t) => t.name)
      );
      const counts: Record<string, number> = {};
      data.dataSources.forEach((ds: any) => {
        if (modelTableNames.has(ds.name)) counts[ds.name] = ds.count || 0;
      });
      model.recommendedTables.forEach((t) => {
        if (!(t.name in counts)) counts[t.name] = 0;
      });
      setTableDataCounts(counts);
    } catch (error) {
      console.error("[ModelTableListView] Error fetching counts:", error);
      setTableDataCounts({});
    }
  }, [model]);

  // Fetch data counts for each table on mount and when model changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCounts();
  }, [fetchCounts]);

  if (!model || !model.recommendedTables?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Database className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">No tables in your data model yet.</p>
        <p className="text-xs mt-1">Configure your model first.</p>
      </div>
    );
  }

  const handleTableClick = (tableName: string) => {
    setSelectedTable(tableName);
    onTableSelect?.(tableName);
  };

  const handleCloseDetail = () => {
    setSelectedTable(null);
  };

  // Show detail view if table is selected
  if (selectedTable) {
    const table = model.recommendedTables.find((t) => t.name === selectedTable);
    if (table) {
      return (
        <ModelTableDetailView
          table={table}
          dataCount={tableDataCounts[selectedTable] || 0}
          allTableDataCounts={tableDataCounts}
          onClose={handleCloseDetail}
          onUploadComplete={fetchCounts}
        />
      );
    }
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold mb-1">
              Your Data Model Tables
            </h2>
            <p className="text-sm text-muted-foreground">
              Click a table to upload data for that specific table, or use{" "}
              <strong>Upload Multiple Files</strong> to classify and map several
              files at once.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setShowMultiUpload(true)}
            className="flex-shrink-0"
          >
            <Files className="h-4 w-4 mr-2" />
            Upload Multiple Files
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {model.recommendedTables.map((table) => {
            const dataCount = tableDataCounts[table.name] || 0;
            const hasData = dataCount > 0;
            const requiredFields = table.fields.filter((f) => f.required);
            const optionalFields = table.fields.filter((f) => !f.required);

            return (
              <Card
                key={table.name}
                className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-primary/50"
                onClick={() => handleTableClick(table.name)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-base font-medium">
                      {getTableDisplayName(table)}
                    </CardTitle>
                    {hasData && (
                      <Badge className="ml-2 bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-300 border-transparent">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        {dataCount} rows
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>
                        {table.fields.length}{" "}
                        {table.fields.length === 1 ? "field" : "fields"}
                      </span>
                      <span>•</span>
                      <span>
                        {requiredFields.length} required
                        {optionalFields.length > 0 &&
                          `, ${optionalFields.length} optional`}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTableClick(table.name);
                      }}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      {hasData ? "View & Upload" : "Upload Data"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      <Dialog open={showMultiUpload} onOpenChange={setShowMultiUpload}>
        <DialogContent
          className="!max-w-[min(1200px,96vw)] !w-[min(1200px,96vw)] !max-h-[85vh] !h-[85vh] !flex flex-col !p-6 rounded-xl overflow-hidden border shadow-xl !gap-0"
          showCloseButton={false}
        >
          {model && (
            <MultiFileUploadView
              model={model}
              allTableDataCounts={tableDataCounts}
              onComplete={() => {
                setShowMultiUpload(false);
                fetchCounts();
              }}
              onCancel={() => setShowMultiUpload(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
