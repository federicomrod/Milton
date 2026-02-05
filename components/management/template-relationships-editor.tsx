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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, ArrowRight } from "lucide-react";
import { getAllDataTables } from "@/lib/data-table-service";
import type { DataTable, DataTableRelationship } from "@/lib/types/data";

interface TemplateRelationshipsEditorProps {
  relationships: DataTableRelationship[];
  onChange: (relationships: DataTableRelationship[]) => void;
  selectedTableIds: string[];
}

export function TemplateRelationshipsEditor({
  relationships,
  onChange,
  selectedTableIds,
}: TemplateRelationshipsEditorProps) {
  const [dataTables, setDataTables] = useState<DataTable[]>([]);

  useEffect(() => {
    const fetchDataTables = async () => {
      const tables = await getAllDataTables();
      setDataTables(tables);
    };
    fetchDataTables();
  }, []);

  const addRelationship = () => {
    const newRelationship: DataTableRelationship = {
      from_table: "",
      from_field: "",
      to_table: "",
      to_field: "",
      relationship_id: `rel_${Date.now()}`,
      relationship_type: "many_to_one",
    };
    onChange([...relationships, newRelationship]);
  };

  const updateRelationship = (
    index: number,
    updates: Partial<DataTableRelationship>
  ) => {
    const newRelationships = [...relationships];
    newRelationships[index] = { ...newRelationships[index], ...updates };
    onChange(newRelationships);
  };

  const removeRelationship = (index: number) => {
    const newRelationships = relationships.filter((_, i) => i !== index);
    onChange(newRelationships);
  };

  const getTableOptions = () => {
    return dataTables
      .filter((table) => selectedTableIds.includes(table.id))
      .map((table) => ({
        value: table.id,
        label: table.name,
      }));
  };

  const getFieldOptions = (tableId: string) => {
    const table = dataTables.find((t) => t.id === tableId);
    if (!table || !table.fields) return [];

    return table.fields.map((field) => ({
      value: field.name,
      label: `${field.name} (${field.type})`,
    }));
  };

  const getRelationshipTypeLabel = (type: string) => {
    const labels = {
      one_to_one: "1:1",
      one_to_many: "1:M",
      many_to_one: "M:1",
      many_to_many: "M:M",
    };
    return labels[type as keyof typeof labels] || type;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Data Table Relationships</CardTitle>
            <CardDescription>
              Define relationships between data tables for proper data modeling
            </CardDescription>
          </div>
          <Button
            onClick={addRelationship}
            size="sm"
            disabled={selectedTableIds.length < 2}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Relationship
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedTableIds.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No data tables selected.</p>
            <p className="text-sm mt-1">
              Please select data tables in the "Data Tables" tab first.
            </p>
          </div>
        ) : relationships.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <p>No relationships defined yet.</p>
            <p className="text-sm mt-1">
              Add relationships to connect your selected data tables properly.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {relationships.map((relationship, index) => (
              <div
                key={relationship.relationship_id}
                className="border rounded-lg p-4 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {getRelationshipTypeLabel(relationship.relationship_type)}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {relationship.relationship_id}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRelationship(index)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>

                <div className="grid grid-cols-12 gap-4 items-end">
                  {/* From Table */}
                  <div className="col-span-3">
                    <Label>From Table</Label>
                    <Select
                      value={relationship.from_table}
                      onValueChange={(value) =>
                        updateRelationship(index, { from_table: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select table" />
                      </SelectTrigger>
                      <SelectContent>
                        {getTableOptions().map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* From Field */}
                  <div className="col-span-3">
                    <Label>From Field</Label>
                    <Select
                      value={relationship.from_field}
                      onValueChange={(value) =>
                        updateRelationship(index, { from_field: value })
                      }
                      disabled={!relationship.from_table}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        {getFieldOptions(relationship.from_table).map(
                          (option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Arrow */}
                  <div className="col-span-1 flex justify-center items-center">
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                  </div>

                  {/* To Table */}
                  <div className="col-span-3">
                    <Label>To Table</Label>
                    <Select
                      value={relationship.to_table}
                      onValueChange={(value) =>
                        updateRelationship(index, { to_table: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select table" />
                      </SelectTrigger>
                      <SelectContent>
                        {getTableOptions().map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* To Field */}
                  <div className="col-span-2">
                    <Label>To Field</Label>
                    <Select
                      value={relationship.to_field}
                      onValueChange={(value) =>
                        updateRelationship(index, { to_field: value })
                      }
                      disabled={!relationship.to_table}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select field" />
                      </SelectTrigger>
                      <SelectContent>
                        {getFieldOptions(relationship.to_table).map(
                          (option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Relationship Type */}
                <div className="flex items-center gap-4">
                  <div>
                    <Label>Relationship Type</Label>
                    <Select
                      value={relationship.relationship_type}
                      onValueChange={(
                        value: DataTableRelationship["relationship_type"]
                      ) =>
                        updateRelationship(index, { relationship_type: value })
                      }
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="one_to_one">One to One</SelectItem>
                        <SelectItem value="one_to_many">One to Many</SelectItem>
                        <SelectItem value="many_to_one">Many to One</SelectItem>
                        <SelectItem value="many_to_many">
                          Many to Many
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
