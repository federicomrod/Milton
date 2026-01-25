"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Upload, CheckCircle2 } from "lucide-react";
import { ModelProposal } from "@/lib/model/transform";
import { createClient } from "@/lib/supabase/client";
import ModelTableDetailView from "./ModelTableDetailView";

interface ModelTableListViewProps {
  model: ModelProposal | null;
  onTableSelect?: (tableName: string) => void;
}

export default function ModelTableListView({
  model,
  onTableSelect,
}: ModelTableListViewProps) {
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableDataCounts, setTableDataCounts] = useState<
    Record<string, number>
  >({});

  // Fetch data counts for each table (model_data is company-scoped)
  useEffect(() => {
    if (!model?.recommendedTables) return;

    const fetchCounts = async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) return;

        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();
        if (!company) {
          setTableDataCounts({});
          return;
        }

        const counts: Record<string, number> = {};
        for (const table of model.recommendedTables || []) {
          const { count } = await supabase
            .from("model_data")
            .select("*", { count: "exact", head: true })
            .eq("company_id", company.id)
            .eq("model_table_name", table.name);

          counts[table.name] = count || 0;
        }

        setTableDataCounts(counts);
      } catch (error) {
        console.error("[ModelTableListView] Error fetching counts:", error);
      }
    };

    fetchCounts();
  }, [model]);

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
          onClose={handleCloseDetail}
          onUploadComplete={() => {
            // Refresh counts after upload (model_data is company-scoped)
            const fetchCounts = async () => {
              try {
                const supabase = createClient();
                const {
                  data: { user },
                } = await supabase.auth.getUser();
                if (!user) return;

                const { data: company } = await supabase
                  .from("companies")
                  .select("id")
                  .eq("created_by", user.id)
                  .single();
                if (!company) return;

                const { count } = await supabase
                  .from("model_data")
                  .select("*", { count: "exact", head: true })
                  .eq("company_id", company.id)
                  .eq("model_table_name", selectedTable);

                setTableDataCounts((prev) => ({
                  ...prev,
                  [selectedTable]: count || 0,
                }));
              } catch (error) {
                console.error("Error refreshing count:", error);
              }
            };
            fetchCounts();
          }}
        />
      );
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">Your Data Model Tables</h2>
        <p className="text-sm text-muted-foreground">
          Click on any table to view its fields and upload data.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {model.recommendedTables.map((table) => {
          const dataCount = tableDataCounts[table.name] || 0;
          const hasData = dataCount > 0;
          const requiredFields = table.fields.filter(
            (f) => !f.nullable && !f.primaryKey
          );
          const optionalFields = table.fields.filter((f) => f.nullable);

          return (
            <Card
              key={table.name}
              className="cursor-pointer hover:shadow-md transition-shadow border-2 hover:border-primary/50"
              onClick={() => handleTableClick(table.name)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-base font-medium">
                    {table.name}
                  </CardTitle>
                  {hasData && (
                    <Badge variant="secondary" className="ml-2">
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
  );
}
