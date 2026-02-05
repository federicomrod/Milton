"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Database, Link, GitBranch } from "lucide-react";
import { getAllDataTables } from "@/lib/data-table-service";
import type { DataTable, DataTableRelationship } from "@/lib/types/data";

// Optional ReactFlow imports - gracefully handle missing package
let ReactFlow: any = null;
let Background: any = null;
let Controls: any = null;
let MiniMap: any = null;
let addEdge: any = null;
let applyNodeChanges: any = null;
let applyEdgeChanges: any = null;

try {
  const reactflowModule = require("reactflow");
  ReactFlow = reactflowModule.default || reactflowModule.ReactFlow;
  Background = reactflowModule.Background;
  Controls = reactflowModule.Controls;
  MiniMap = reactflowModule.MiniMap;
  addEdge = reactflowModule.addEdge;
  applyNodeChanges = reactflowModule.applyNodeChanges;
  applyEdgeChanges = reactflowModule.applyEdgeChanges;
  require("reactflow/dist/style.css");
} catch (e) {
  console.warn("reactflow not installed. Run: npm install reactflow");
}

interface TemplateModelPreviewProps {
  selectedTableIds: string[];
  relationships: DataTableRelationship[];
}

export function TemplateModelPreview({
  selectedTableIds,
  relationships,
}: TemplateModelPreviewProps) {
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [viewMode, setViewMode] = useState<"grid" | "graph">("graph");

  useEffect(() => {
    const fetchDataTables = async () => {
      const tables = await getAllDataTables();
      setDataTables(tables);
    };
    fetchDataTables();
  }, []);

  const selectedTables = dataTables.filter((table) =>
    selectedTableIds.includes(table.id)
  );

  // Create graph layout for template visualization
  const createGraphLayout = () => {
    const positions: Record<string, { x: number; y: number }> = {};
    const centerX = 300;
    const centerY = 200;
    const radius = Math.min(150, selectedTables.length * 25);

    selectedTables.forEach((table, index) => {
      const angle = (index / selectedTables.length) * 2 * Math.PI;
      positions[table.id] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });

    return positions;
  };

  const tablePositions = createGraphLayout();

  const getRelationshipTypeLabel = (type: string) => {
    const labels = {
      one_to_one: "1:1",
      one_to_many: "1:M",
      many_to_one: "M:1",
      many_to_many: "M:M",
    };
    return labels[type as keyof typeof labels] || type;
  };

  if (selectedTables.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Model Preview</CardTitle>
          <CardDescription>
            Visual representation of your template's data structure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No data tables selected</p>
            <p className="text-sm mt-1">
              Select tables in the "Data Tables" tab to see the model preview
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!ReactFlow) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Data Model Preview</CardTitle>
          <CardDescription>
            Visual representation of your template's data structure with{" "}
            {selectedTables.length} tables and {relationships.length}{" "}
            relationships
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            <GitBranch className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>ReactFlow is not installed</p>
            <p className="text-sm mt-1">Run: npm install reactflow</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Data Model Preview</CardTitle>
            <CardDescription>
              Visual representation of your template's data structure with{" "}
              {selectedTables.length} tables and {relationships.length}{" "}
              relationships
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("grid")}
            >
              <Database className="h-4 w-4 mr-2" />
              Grid
            </Button>
            <Button
              variant={viewMode === "graph" ? "default" : "outline"}
              size="sm"
              onClick={() => setViewMode("graph")}
            >
              <GitBranch className="h-4 w-4 mr-2" />
              Graph
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {viewMode === "graph" && selectedTables.length > 0 && (
          <div className="relative h-[500px] border rounded-lg bg-slate-50">
            <ReactFlow
              nodes={selectedTables.map((table) => ({
                id: table.id,
                data: {
                  label: (
                    <div className="text-sm font-medium text-center">
                      <div>{table.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {Array.isArray(table.fields) ? table.fields.length : 0}{" "}
                        fields
                      </div>
                    </div>
                  ),
                },
                position: tablePositions[table.id] || { x: 0, y: 0 },
                style: {
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  padding: 8,
                  fontSize: 12,
                  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                },
              }))}
              edges={relationships.map((relationship, index) => ({
                id: `rel-${index}`,
                source: relationship.from_table,
                target: relationship.to_table,
                animated: true,
                label: getRelationshipTypeLabel(relationship.relationship_type),
                style: { stroke: "#6366f1", strokeWidth: 2 },
                labelStyle: { fontSize: 10, fill: "#6366f1" },
              }))}
              fitView
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={true}
              panOnScroll={true}
              zoomOnScroll={true}
              zoomOnPinch={true}
              zoomOnDoubleClick={true}
              nodesFocusable={false}
              edgesFocusable={false}
              disableKeyboardA11y={true}
            >
              <MiniMap />
              <Controls />
              <Background />
            </ReactFlow>
          </div>
        )}

        {viewMode === "grid" && (
          <>
            {/* Tables Overview */}
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Database className="h-4 w-4" />
                Data Tables ({selectedTables.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {selectedTables.map((table) => (
                  <div
                    key={table.id}
                    className="border rounded-lg p-3 bg-muted/30"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-sm">{table.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {Array.isArray(table.fields) ? table.fields.length : 0}{" "}
                        fields
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {table.description || "No description"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {table.slug}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Relationships */}
            {relationships.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Link className="h-4 w-4" />
                  Relationships ({relationships.length})
                </h4>
                <div className="space-y-2">
                  {relationships.map((relationship, index) => {
                    const fromTable = dataTables.find(
                      (t) => t.id === relationship.from_table
                    );
                    const toTable = dataTables.find(
                      (t) => t.id === relationship.to_table
                    );

                    return (
                      <div
                        key={relationship.relationship_id || index}
                        className="border rounded-lg p-3"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              {fromTable?.name || relationship.from_table}
                            </span>
                            <span className="text-muted-foreground">→</span>
                            <span className="font-medium text-sm">
                              {toTable?.name || relationship.to_table}
                            </span>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {getRelationshipTypeLabel(
                              relationship.relationship_type
                            )}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {relationship.from_field} → {relationship.to_field}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Model Statistics */}
            <div className="border-t pt-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold">
                    {selectedTables.length}
                  </div>
                  <div className="text-xs text-muted-foreground">Tables</div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {selectedTables.reduce(
                      (sum, table) =>
                        sum +
                        (Array.isArray(table.fields) ? table.fields.length : 0),
                      0
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Total Fields
                  </div>
                </div>
                <div>
                  <div
                    className={`text-2xl font-bold ${relationships.length === 0 && selectedTables.length > 1 ? "text-amber-600" : ""}`}
                  >
                    {relationships.length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Relationships
                    {relationships.length === 0 &&
                      selectedTables.length > 1 && (
                        <span className="text-amber-600 ml-1">⚠️</span>
                      )}
                  </div>
                </div>
                <div>
                  <div className="text-2xl font-bold">
                    {
                      relationships.filter(
                        (r) => r.relationship_type === "many_to_one"
                      ).length
                    }
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Foreign Keys
                  </div>
                </div>
              </div>

              {relationships.length === 0 && selectedTables.length > 1 && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-sm text-amber-800">
                    <strong>Tip:</strong> Consider adding relationships between
                    your tables to create a proper data model. Most databases
                    benefit from defined relationships for data integrity and
                    query performance.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
