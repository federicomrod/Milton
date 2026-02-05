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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MetricFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric?: any | null;
  onSuccess: () => void;
}

interface FormData {
  slug: string;
  name: string;
  description: string;
  category: "core" | "ltm" | "advanced";
}

export function MetricFormDialog({
  open,
  onOpenChange,
  metric,
  onSuccess,
}: MetricFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      slug: "",
      name: "",
      description: "",
      category: "core",
    },
  });

  const watchedSlug = watch("slug");
  const watchedName = watch("name");
  const watchedDescription = watch("description");
  const watchedCategory = watch("category");

  useEffect(() => {
    if (metric) {
      reset({
        slug: metric.slug,
        name: metric.name,
        description: metric.description || "",
        category: metric.category,
      });
    } else {
      reset({
        slug: "",
        name: "",
        description: "",
        category: "core",
      });
    }
  }, [metric, reset, open]);

  // Auto-generate slug from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    if (!metric) {
      // Only auto-generate for new metrics
      const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      setValue("slug", slug);
    }
  };

  const onSubmit = async (data: FormData) => {
    setLoading(true);

    try {
      const url = metric
        ? `/api/admin/metrics/${metric.id}`
        : "/api/admin/metrics";
      const method = metric ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save metric");
      }

      toast({
        title: "Success",
        description: metric
          ? "Metric updated successfully"
          : "Metric created successfully",
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

  const getCategoryInfo = (category: string) => {
    const info: Record<string, { label: string; description: string }> = {
      core: {
        label: "Core",
        description: "Essential business metrics tracked monthly",
      },
      ltm: {
        label: "LTM",
        description: "Last twelve months trailing metrics",
      },
      advanced: {
        label: "Advanced",
        description: "Specialized or calculated metrics",
      },
    };
    return info[category] || info.core;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!w-[95vw] !max-w-none max-h-[90vh] overflow-y-auto"
        style={{ width: "95vw" }}
      >
        <DialogHeader>
          <DialogTitle>{metric ? "Edit Metric" : "Create Metric"}</DialogTitle>
          <DialogDescription>
            Define a business metric with its category and description
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
                onChange={(e) => {
                  register("name").onChange(e);
                  handleNameChange(e);
                }}
                placeholder="Monthly Recurring Revenue"
              />
              {errors.name && (
                <p className="text-sm text-destructive">Name is required</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug">Slug *</Label>
              <Input
                id="slug"
                {...register("slug", {
                  required: true,
                  pattern: /^[a-z0-9_]+$/,
                })}
                placeholder="monthly_recurring_revenue"
              />
              {errors.slug && (
                <p className="text-sm text-destructive">
                  Slug is required and must be lowercase with underscores
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                URL-friendly identifier (lowercase, underscores only)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                {...register("description")}
                placeholder="Total recurring subscription revenue in a given month..."
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                value={watchedCategory}
                onValueChange={(value: any) => setValue("category", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="core">Core</SelectItem>
                  <SelectItem value="ltm">LTM</SelectItem>
                  <SelectItem value="advanced">Advanced</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {getCategoryInfo(watchedCategory).description}
              </p>
            </div>
          </form>

          {/* Live Preview */}
          <div className="space-y-4">
            <div>
              <Label>Live Preview</Label>
              <p className="text-xs text-muted-foreground mb-3">
                See how your metric will appear
              </p>
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">
                      {watchedName || "Metric Name"}
                    </CardTitle>
                    <CardDescription>
                      {watchedDescription ||
                        "Metric description will appear here"}
                    </CardDescription>
                  </div>
                  <Badge variant="secondary">
                    {watchedCategory.toUpperCase()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-3xl font-bold">$0</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Example Value
                  </p>
                </div>

                {watchedSlug && (
                  <div className="pt-4 border-t">
                    <p className="text-xs font-medium mb-2">Identifier:</p>
                    <code className="text-xs bg-muted px-2 py-1 rounded">
                      {watchedSlug}
                    </code>
                  </div>
                )}

                <div className="pt-4 border-t">
                  <p className="text-xs font-medium mb-2">Category:</p>
                  <p className="text-sm text-muted-foreground">
                    {getCategoryInfo(watchedCategory).description}
                  </p>
                </div>
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
          <Button onClick={handleSubmit(onSubmit)} disabled={loading}>
            {loading ? "Saving..." : metric ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
