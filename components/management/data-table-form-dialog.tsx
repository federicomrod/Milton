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
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2 } from "lucide-react";
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
  business_model_template_key: string;
  fields: DataTableField[];
}

const fieldTypes = ["string", "number", "date", "boolean"];
const templateOptions = [
  { value: "none", label: "None" },
  { value: "saas", label: "SaaS" },
  { value: "fitness_studio", label: "Fitness Studio" },
  { value: "agency", label: "Agency" },
];

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
      business_model_template_key: "",
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

  useEffect(() => {
    if (dataTable) {
      reset({
        slug: dataTable.slug,
        name: dataTable.name,
        description: dataTable.description || "",
        business_model_template_key:
          dataTable.business_model_template_key || "none",
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
    } else {
      reset({
        slug: "",
        name: "",
        description: "",
        business_model_template_key: "none",
        fields: [
          { name: "", type: "string", required: false, primaryKey: false },
        ],
      });
    }
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

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: data.slug,
          name: data.name,
          description: data.description || null,
          business_model_template_key:
            data.business_model_template_key === "none"
              ? null
              : data.business_model_template_key,
          fields: data.fields,
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

            <div className="space-y-2">
              <Label htmlFor="template">Business Model Template</Label>
              <Select
                value={watch("business_model_template_key")}
                onValueChange={(value) =>
                  setValue("business_model_template_key", value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a template (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {templateOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-12 gap-2 items-start p-3 border rounded-lg"
                >
                  <div className="col-span-4">
                    <Input
                      {...register(`fields.${index}.name` as const, {
                        required: true,
                      })}
                      placeholder="Field name"
                    />
                  </div>

                  <div className="col-span-3">
                    <Select
                      value={watchedFields[index]?.type || "string"}
                      onValueChange={(value) =>
                        setValue(`fields.${index}.type`, value)
                      }
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

                  <div className="col-span-2 flex items-center space-x-2">
                    <Checkbox
                      id={`required-${index}`}
                      checked={watchedFields[index]?.required || false}
                      onCheckedChange={(checked) =>
                        setValue(`fields.${index}.required`, checked as boolean)
                      }
                    />
                    <Label
                      htmlFor={`required-${index}`}
                      className="text-sm font-normal"
                    >
                      Required
                    </Label>
                  </div>

                  <div className="col-span-2 flex items-center space-x-2">
                    <Checkbox
                      id={`primary-${index}`}
                      checked={watchedFields[index]?.primaryKey || false}
                      onCheckedChange={(checked) =>
                        setValue(
                          `fields.${index}.primaryKey`,
                          checked as boolean
                        )
                      }
                    />
                    <Label
                      htmlFor={`primary-${index}`}
                      className="text-sm font-normal"
                    >
                      Primary
                    </Label>
                  </div>

                  <div className="col-span-1 flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(index)}
                      disabled={fields.length === 1}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
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
