"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/components/ui/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAllDataTables } from "@/lib/data-table-service";
import type { DataTable } from "@/lib/types/data";

interface KpiFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kpi?: any | null;
  onSuccess: () => void;
}

interface FormData {
  name: string;
  definition: string;
  required_data: string[];
  formula: string;
  is_published: boolean;
  notes: string;
}

export function KpiFormDialog({
  open,
  onOpenChange,
  kpi,
  onSuccess,
}: KpiFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [flexibilityJson, setFlexibilityJson] = useState<string>("{}");
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      name: "",
      definition: "",
      required_data: [],
      formula: "",
      is_published: false,
      notes: "",
    },
  });

  const watchedName = watch("name");
  const watchedDefinition = watch("definition");

  useEffect(() => {
    if (open) {
      fetchDataTables();
    }
  }, [open]);

  useEffect(() => {
    if (kpi) {
      reset({
        name: kpi.name,
        definition: kpi.definition,
        required_data: kpi.required_data || [],
        formula: kpi.formula || "",
        is_published: kpi.is_published || false,
        notes: kpi.notes || "",
      });
      setSelectedTables(kpi.required_data || []);
      setFlexibilityJson(JSON.stringify(kpi.flexibility || {}, null, 2));
    } else {
      reset({
        name: "",
        definition: "",
        required_data: [],
        formula: "",
        is_published: false,
        notes: "",
      });
      setSelectedTables([]);
      setFlexibilityJson("{}");
    }
  }, [kpi, reset, open]);

  const fetchDataTables = async () => {
    try {
      const tables = await getAllDataTables();
      setDataTables(tables);
    } catch (error) {
      console.error("Failed to fetch data tables:", error);
    }
  };

  const toggleTable = (tableId: string) => {
    setSelectedTables((prev) =>
      prev.includes(tableId)
        ? prev.filter((t) => t !== tableId)
        : [...prev, tableId]
    );
  };

  const onSubmit = async (data: FormData & { required_data?: string[] }) => {
    setLoading(true);

    try {
      // Parse flexibility JSON
      let flexibility = {};
      try {
        flexibility = JSON.parse(flexibilityJson || "{}");
      } catch (error) {
        toast({
          title: "Validation Error",
          description: "Flexibility configuration must be valid JSON",
          variant: "destructive",
        });
        return;
      }

      const url = kpi ? `/api/admin/kpis/${kpi.id}` : "/api/admin/kpis";
      const method = kpi ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          definition: data.definition,
          required_data: selectedTables,
          flexibility,
          formula: data.formula || null,
          is_published: data.is_published || false,
          notes: data.notes || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save KPI");
      }

      toast({
        title: "Success",
        description: kpi
          ? "KPI updated successfully"
          : "KPI created successfully",
      });

      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[95vw] !max-w-none max-h-[90vh] overflow-y-auto"
        style={{ width: "95vw" }}
      >
        <DialogHeader>
          <DialogTitle>{kpi ? "Edit KPI" : "Create KPI"}</DialogTitle>
          <DialogDescription>
            Define a key performance indicator with its data requirements
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6">
          {/* Form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                {...register("name", { required: true })}
                placeholder="Active Members"
              />
              {errors.name && (
                <p className="text-sm text-destructive">Name is required</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="definition">Definition *</Label>
              <Textarea
                id="definition"
                {...register("definition", { required: true })}
                placeholder="The number of members with an active subscription..."
                rows={3}
              />
              {errors.definition && (
                <p className="text-sm text-destructive">
                  Definition is required
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Required Data Tables</Label>
              <div className="border rounded-md p-3 space-y-2 max-h-48 overflow-y-auto">
                {dataTables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No data tables available
                  </p>
                ) : (
                  dataTables.map((table) => (
                    <label
                      key={table.id}
                      className="flex items-start space-x-2 cursor-pointer hover:bg-accent p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTables.includes(table.id)}
                        onChange={() => toggleTable(table.id)}
                        className="rounded border-gray-300 mt-0.5 flex-shrink-0"
                      />
                      <div>
                        <span className="text-sm font-medium">
                          {table.name}
                        </span>
                        {table.description && (
                          <p className="text-xs text-muted-foreground leading-snug">
                            {table.description}
                          </p>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Select tables required to calculate this KPI
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="flexibility">Flexibility Configuration</Label>
              <Textarea
                id="flexibility"
                value={flexibilityJson}
                onChange={(e) => {
                  setFlexibilityJson(e.target.value);
                }}
                placeholder='{"allowed": {"aggregation": "Period total"}, "not_allowed": ["Custom definitions"]}'
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                JSON configuration defining what operations are allowed or not
                allowed for this KPI
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="formula">Formula</Label>
              <Textarea
                id="formula"
                {...register("formula")}
                placeholder="Describe the calculation formula for this KPI..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Descriptive field for the formula (formulas are implemented
                manually in the codebase)
              </p>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="is_published"
                {...register("is_published")}
                checked={watch("is_published")}
                onCheckedChange={(checked) => {
                  reset({ ...watch(), is_published: checked as boolean });
                }}
              />
              <Label htmlFor="is_published">Published</Label>
              <p className="text-xs text-muted-foreground">
                When enabled, this KPI will be available on the frontend for
                users
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea
                id="notes"
                {...register("notes")}
                placeholder="Internal notes for the team..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground">
                Private notes for the team (not visible to non-admin users)
              </p>
            </div>
          </form>

          {/* Live Preview */}
          <div className="space-y-4">
            <div>
              <Label>Live Preview</Label>
              <p className="text-xs text-muted-foreground mb-3">
                See how your KPI will appear
              </p>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  {watchedName || "KPI Name"}
                </CardTitle>
                <CardDescription>
                  {watchedDefinition || "KPI definition will appear here"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-3xl font-bold">—</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Current Value
                  </p>
                </div>

                {selectedTables.length > 0 && (
                  <div className="pt-4 border-t">
                    <p className="text-xs font-medium mb-2">Required Data:</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedTables.map((tableId) => {
                        const table = dataTables.find((t) => t.id === tableId);
                        return (
                          <span
                            key={tableId}
                            className="text-xs bg-secondary px-2 py-1 rounded"
                          >
                            {table ? table.name : tableId}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={loading}
            type="submit"
          >
            {loading ? "Saving..." : kpi ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
