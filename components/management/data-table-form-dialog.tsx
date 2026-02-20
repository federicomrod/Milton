"use client";

import { useEffect, useState } from "react";
import { useForm, useFieldArray } from "react-hook-form";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2, ListFilter, X } from "lucide-react";
import type { DataTable, DataTableField } from "@/lib/types/data";

interface DataTableFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dataTable?: DataTable | null;
  onSuccess: () => void;
}

interface FormData {
  slug: string;
  name: string;
  description: string;
  fields: DataTableField[];
}

const fieldTypes = ["string", "number", "date", "boolean"];

export function DataTableFormDialog({
  open,
  onOpenChange,
  dataTable,
  onSuccess,
}: DataTableFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      slug: "",
      name: "",
      description: "",
      fields: [
        { name: "", type: "string", required: false, primaryKey: false },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "fields",
  });

  const watchedFields = watch("fields");
  const [expandedAllowedValues, setExpandedAllowedValues] = useState<
    Set<number>
  >(new Set());
  const [newValueInputs, setNewValueInputs] = useState<Record<number, string>>(
    {}
  );

  const toggleAllowedValues = (index: number) => {
    setExpandedAllowedValues((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const addAllowedValue = (fieldIndex: number) => {
    const value = (newValueInputs[fieldIndex] || "").trim();
    if (!value) return;
    const current = watchedFields[fieldIndex]?.allowedValues || [];
    if (current.some((v) => v.toLowerCase() === value.toLowerCase())) return;
    setValue(`fields.${fieldIndex}.allowedValues`, [...current, value]);
    setNewValueInputs((prev) => ({ ...prev, [fieldIndex]: "" }));
  };

  const removeAllowedValue = (fieldIndex: number, valueIndex: number) => {
    const current = watchedFields[fieldIndex]?.allowedValues || [];
    setValue(
      `fields.${fieldIndex}.allowedValues`,
      current.filter((_, i) => i !== valueIndex)
    );
  };

  useEffect(() => {
    if (dataTable) {
      reset({
        slug: dataTable.slug,
        name: dataTable.name,
        description: dataTable.description || "",
        fields:
          dataTable.fields.length > 0
            ? dataTable.fields
            : [
                {
                  name: "",
                  type: "string",
                  required: false,
                  primaryKey: false,
                },
              ],
      });
      const expanded = new Set<number>();
      dataTable.fields.forEach((f, i) => {
        if (f.allowedValues && f.allowedValues.length > 0) expanded.add(i);
      });
      setExpandedAllowedValues(expanded);
    } else {
      reset({
        slug: "",
        name: "",
        description: "",
        fields: [
          { name: "", type: "string", required: false, primaryKey: false },
        ],
      });
      setExpandedAllowedValues(new Set());
    }
    setNewValueInputs({});
  }, [dataTable, reset, open]);

  const onSubmit = async (data: FormData) => {
    // Validation
    if (data.fields.length === 0) {
      toast({
        title: "Validation Error",
        description: "At least one field is required",
        variant: "destructive",
      });
      return;
    }

    const invalidFields = data.fields.filter((f) => !f.name || !f.type);
    if (invalidFields.length > 0) {
      toast({
        title: "Validation Error",
        description: "All fields must have a name and type",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const url = dataTable
        ? `/api/admin/data-tables/${dataTable.id}`
        : "/api/admin/data-tables";
      const method = dataTable ? "PUT" : "POST";

      const cleanedFields = data.fields.map((f) => {
        const field = { ...f };
        if (
          !field.allowedValues ||
          field.allowedValues.length === 0 ||
          field.type !== "string"
        ) {
          delete field.allowedValues;
        }
        return field;
      });

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: data.slug,
          name: data.name,
          description: data.description || null,
          fields: cleanedFields,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save data table");
      }

      toast({
        title: "Success",
        description: dataTable
          ? "Data table updated successfully"
          : "Data table created successfully",
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
          <DialogTitle>
            {dataTable ? "Edit Data Table" : "Create Data Table"}
          </DialogTitle>
          <DialogDescription>
            Define the structure and metadata for a data table
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  {...register("name", { required: true })}
                  placeholder="Customers"
                />
                {errors.name && (
                  <p className="text-sm text-destructive">Name is required</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Slug *</Label>
                <Input
                  id="slug"
                  {...register("slug", { required: true })}
                  placeholder="customers"
                />
                {errors.slug && (
                  <p className="text-sm text-destructive">Slug is required</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...register("description")}
                placeholder="Describe what this table represents..."
                rows={2}
              />
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Fields *</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  append({
                    name: "",
                    type: "string",
                    required: false,
                    primaryKey: false,
                  })
                }
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Field
              </Button>
            </div>

            <div className="space-y-3">
              {fields.map((field, index) => {
                const isString = watchedFields[index]?.type === "string";
                const currentAllowed =
                  watchedFields[index]?.allowedValues || [];
                const isExpanded = expandedAllowedValues.has(index);

                return (
                  <div key={field.id} className="border rounded-lg">
                    <div className="grid grid-cols-12 gap-2 items-start p-3">
                      <div className="col-span-3">
                        <Input
                          {...register(`fields.${index}.name` as const, {
                            required: true,
                          })}
                          placeholder="Field name"
                        />
                      </div>

                      <div className="col-span-2">
                        <Select
                          value={watchedFields[index]?.type || "string"}
                          onValueChange={(value) => {
                            setValue(`fields.${index}.type`, value);
                            if (value !== "string") {
                              setValue(
                                `fields.${index}.allowedValues`,
                                undefined
                              );
                              setExpandedAllowedValues((prev) => {
                                const next = new Set(prev);
                                next.delete(index);
                                return next;
                              });
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {fieldTypes.map((type) => (
                              <SelectItem key={type} value={type}>
                                {type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="col-span-2 flex items-center space-x-2 pt-2">
                        <Checkbox
                          id={`required-${index}`}
                          checked={watchedFields[index]?.required || false}
                          onCheckedChange={(checked) =>
                            setValue(
                              `fields.${index}.required`,
                              checked as boolean
                            )
                          }
                        />
                        <Label
                          htmlFor={`required-${index}`}
                          className="text-sm font-normal"
                        >
                          Required
                        </Label>
                      </div>

                      <div className="col-span-2 flex items-center space-x-2 pt-2">
                        <Checkbox
                          id={`primary-${index}`}
                          checked={watchedFields[index]?.primaryKey || false}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              watchedFields.forEach((_, i) => {
                                if (i !== index) {
                                  setValue(`fields.${i}.primaryKey`, false);
                                }
                              });
                            }
                            setValue(
                              `fields.${index}.primaryKey`,
                              checked as boolean
                            );
                          }}
                        />
                        <Label
                          htmlFor={`primary-${index}`}
                          className="text-sm font-normal"
                        >
                          Primary
                        </Label>
                      </div>

                      <div className="col-span-2 flex items-center pt-1">
                        {isString && (
                          <Button
                            type="button"
                            variant={
                              currentAllowed.length > 0 ? "secondary" : "ghost"
                            }
                            size="sm"
                            className="h-8 text-xs gap-1.5"
                            onClick={() => toggleAllowedValues(index)}
                          >
                            <ListFilter className="h-3.5 w-3.5" />
                            {currentAllowed.length > 0
                              ? `${currentAllowed.length} values`
                              : "Allowed values"}
                          </Button>
                        )}
                      </div>

                      <div className="col-span-1 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            remove(index);
                            setExpandedAllowedValues((prev) => {
                              const next = new Set<number>();
                              for (const i of prev) {
                                if (i < index) next.add(i);
                                else if (i > index) next.add(i - 1);
                              }
                              return next;
                            });
                          }}
                          disabled={fields.length === 1}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {isString && isExpanded && (
                      <div className="px-3 pb-3 pt-0">
                        <div className="bg-muted/50 rounded-md p-3 space-y-2">
                          <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground">
                              Allowed Values
                            </Label>
                            <span className="text-xs text-muted-foreground">
                              — values uploaded data will be normalized to
                            </span>
                          </div>

                          {currentAllowed.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {currentAllowed.map((val, valIdx) => (
                                <Badge
                                  key={valIdx}
                                  variant="secondary"
                                  className="gap-1 pr-1"
                                >
                                  {val}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeAllowedValue(index, valIdx)
                                    }
                                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                          )}

                          <div className="flex gap-2">
                            <Input
                              placeholder="Add a value..."
                              className="h-8 text-sm"
                              value={newValueInputs[index] || ""}
                              onChange={(e) =>
                                setNewValueInputs((prev) => ({
                                  ...prev,
                                  [index]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addAllowedValue(index);
                                }
                              }}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => addAllowedValue(index)}
                            >
                              <Plus className="h-3.5 w-3.5 mr-1" />
                              Add
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : dataTable ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
