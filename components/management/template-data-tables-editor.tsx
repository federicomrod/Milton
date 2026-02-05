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
import { Badge } from "@/components/ui/badge";
import { getAllDataTables } from "@/lib/data-table-service";
import type { DataTable } from "@/lib/types/data";

interface TemplateDataTablesEditorProps {
  selectedTableIds: string[];
  onChange: (tableIds: string[]) => void;
}

export function TemplateDataTablesEditor({
  selectedTableIds,
  onChange,
}: TemplateDataTablesEditorProps) {
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDataTables();
  }, []);

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

  const toggleTable = (tableId: string) => {
    if (selectedTableIds.includes(tableId)) {
      onChange(selectedTableIds.filter((id) => id !== tableId));
    } else {
      onChange([...selectedTableIds, tableId]);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading data tables...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data Tables</CardTitle>
        <CardDescription>
          Select the data tables required for this business model template
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {dataTables.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No data tables available
            </p>
          ) : (
            dataTables.map((table) => (
              <label
                key={table.id}
                className="flex items-start space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
              >
                <Checkbox
                  checked={selectedTableIds.includes(table.id)}
                  onCheckedChange={() => toggleTable(table.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{table.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {table.slug}
                    </Badge>
                  </div>
                  {table.description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {table.description}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    {Array.isArray(table.fields) ? table.fields.length : 0}{" "}
                    fields
                  </p>
                </div>
              </label>
            ))
          )}
        </div>
        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedTableIds.length} table(s) selected
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
