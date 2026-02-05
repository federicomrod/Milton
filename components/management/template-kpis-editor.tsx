"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { getAllDataTables } from "@/lib/data-table-service";
import type { DataTable } from "@/lib/types/data";

interface Kpi {
  id: string;
  name: string;
  definition: string;
  required_data?: string[];
}

interface TemplateKpisEditorProps {
  selectedKpiIds: string[];
  onChange: (kpiIds: string[]) => void;
  selectedTableIds: string[];
}

export function TemplateKpisEditor({
  selectedKpiIds,
  onChange,
  selectedTableIds,
}: TemplateKpisEditorProps) {
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchKpis();
    fetchDataTables();
  }, []);

  const fetchKpis = async () => {
    try {
      const response = await fetch("/api/admin/kpis");
      if (response.ok) {
        const data = await response.json();
        setKpis(data);
      }
    } catch (error) {
      console.error("Failed to fetch KPIs:", error);
    }
  };

  const fetchDataTables = async () => {
    try {
      const tables = await getAllDataTables();
      setDataTables(tables);
    } catch (error) {
      console.error("Failed to fetch data tables:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleKpi = (kpiId: string) => {
    if (selectedKpiIds.includes(kpiId)) {
      onChange(selectedKpiIds.filter((id) => id !== kpiId));
    } else {
      onChange([...selectedKpiIds, kpiId]);
    }
  };

  // Create mapping from table ID to name for display
  const tableIdToName = dataTables.reduce(
    (acc, table) => {
      acc[table.id] = table.name;
      return acc;
    },
    {} as Record<string, string>
  );

  // Helper function to get display name for a table ID
  const getTableDisplayName = (tableId: string) => {
    return tableIdToName[tableId] || tableId;
  };

  // Helper function to check if a table requirement is available (only by ID)
  const isTableAvailable = (tableId: string) => {
    return selectedTableIds.includes(tableId);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading KPIs...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>KPIs</CardTitle>
        <CardDescription>
          Select the KPIs that are relevant for this business model template
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {kpis.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No KPIs available
            </p>
          ) : (
            kpis.map((kpi) => {
              const requiredData = kpi.required_data || [];
              const hasRequiredData = requiredData.length > 0;
              const hasAllRequiredTables =
                hasRequiredData &&
                requiredData.every((table) => isTableAvailable(table));
              const isEnabled = hasRequiredData && hasAllRequiredTables;
              const missingTables = requiredData.filter(
                (table) => !isTableAvailable(table)
              );

              return (
                <label
                  key={kpi.id}
                  className={`flex items-start space-x-3 p-3 border rounded-lg transition-colors ${
                    isEnabled
                      ? "cursor-pointer hover:bg-accent"
                      : "cursor-not-allowed opacity-60"
                  }`}
                >
                  <Checkbox
                    checked={selectedKpiIds.includes(kpi.id)}
                    onCheckedChange={() => toggleKpi(kpi.id)}
                    disabled={!isEnabled}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="font-medium">{kpi.name}</div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {kpi.definition}
                    </p>
                    {hasRequiredData && (
                      <div className="mt-2 flex items-center justify-between">
                        <div className="flex flex-wrap gap-1">
                          {requiredData.map((tableIdentifier) => (
                            <span
                              key={tableIdentifier}
                              className={`text-xs px-2 py-1 rounded ${
                                isTableAvailable(tableIdentifier)
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {getTableDisplayName(tableIdentifier)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {!hasRequiredData && (
                      <div className="mt-2">
                        <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600">
                          No data tables required
                        </span>
                      </div>
                    )}
                    {!isEnabled && !hasRequiredData && (
                      <p className="text-xs text-orange-600 mt-2">
                        No data tables configured for this KPI
                      </p>
                    )}
                    {!isEnabled &&
                      hasRequiredData &&
                      missingTables.length > 0 && (
                        <p className="text-xs text-red-600 mt-2">
                          Missing required data tables:{" "}
                          {missingTables
                            .map((identifier) =>
                              getTableDisplayName(identifier)
                            )
                            .join(", ")}
                        </p>
                      )}
                  </div>
                </label>
              );
            })
          )}
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedKpiIds.length} KPI(s) selected
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
