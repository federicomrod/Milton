"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Settings2, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { MetricOption } from "@/lib/types/metric";
import { Loader2 } from "lucide-react";

interface MetricSelectorProps {
  selectedMetrics: string[];
  onMetricsChange: (metrics: string[]) => void;
  businessType?: string | null;
}

export function MetricSelector({
  selectedMetrics,
  onMetricsChange,
  businessType,
}: MetricSelectorProps) {
  const [open, setOpen] = useState(false);
  const [tempSelection, setTempSelection] = useState<string[]>(selectedMetrics);
  const [availableMetrics, setAvailableMetrics] = useState<MetricOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch available metrics when dialog opens
  useEffect(() => {
    if (open && availableMetrics.length === 0) {
      fetchAvailableMetrics();
    }
  }, [open]);

  // Update temp selection when selectedMetrics changes
  useEffect(() => {
    setTempSelection(selectedMetrics);
  }, [selectedMetrics]);

  const fetchAvailableMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/metrics/available");
      if (response.ok) {
        const metrics = await response.json();
        // Convert from database format to MetricOption format
        const metricOptions: MetricOption[] = metrics.map((metric: any) => ({
          id: metric.slug, // Use slug as id for backward compatibility
          title: metric.name,
          description: metric.description || "",
          category: metric.category,
        }));
        setAvailableMetrics(metricOptions);
      }
    } catch (error) {
      console.error("Failed to fetch available metrics:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleMetric = (metricId: string) => {
    setTempSelection((prev) =>
      prev.includes(metricId)
        ? prev.filter((id) => id !== metricId)
        : [...prev, metricId]
    );
  };

  const handleSave = async () => {
    // Get the metric UUIDs for the selected metric slugs
    const selectedMetricSlugs = tempSelection;
    const selectedMetricIds = availableMetrics
      .filter((metric) => selectedMetricSlugs.includes(metric.id))
      .map((metric) => metric.id); // In this case, we're still using slugs

    // Call the onMetricsChange callback with the selected metric slugs
    onMetricsChange(selectedMetricSlugs);
    setOpen(false);
  };

  const handleCancel = () => {
    setTempSelection(selectedMetrics);
    setOpen(false);
  };

  const getCategoryMetrics = (category: string) => {
    return availableMetrics.filter((metric) => metric.category === category);
  };

  const renderMetricCategory = (
    title: string,
    category: string,
    description: string
  ) => (
    <div key={category} className="space-y-3">
      <div>
        <h4 className="font-medium text-sm">{title}</h4>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="grid grid-cols-1 gap-3">
        {getCategoryMetrics(category).map((metric) => (
          <Card
            key={metric.id}
            className={`cursor-pointer transition-all ${
              tempSelection.includes(metric.id)
                ? "border-primary bg-primary/10"
                : "hover:border-primary/50"
            }`}
            onClick={() => handleToggleMetric(metric.id)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{metric.title}</CardTitle>
                <Checkbox
                  checked={tempSelection.includes(metric.id)}
                  onCheckedChange={() => handleToggleMetric(metric.id)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {metric.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          Customize Metrics
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize Dashboard Metrics</DialogTitle>
          <DialogDescription>
            Select which metrics you want to display on your dashboard. You can
            show up to 8 metrics at once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="ml-2">Loading metrics...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {renderMetricCategory(
                "Core Metrics",
                "core",
                "Essential for tracking business performance"
              )}
              {renderMetricCategory(
                "LTM Comparisons",
                "ltm",
                "12-month rolling averages for trend analysis"
              )}
              {renderMetricCategory(
                "Advanced Analytics",
                "advanced",
                "Deeper insights requiring additional data"
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-border">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {tempSelection.length} of 8 metrics selected
            </p>
            {tempSelection.length > 8 && (
              <p className="text-xs text-destructive">
                Please select 8 or fewer metrics for optimal display
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={tempSelection.length === 0 || tempSelection.length > 8}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
