"use client";

import { useState } from "react";
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
import { KPI_TEMPLATES } from "@/lib/kpi-templates";

interface MetricOption {
  id: string;
  title: string;
  description: string;
  defaultEnabled: boolean;
  category?: "core" | "ltm" | "advanced";
}

const availableMetrics: MetricOption[] = [
  // Core Metrics
  {
    id: "mrr",
    title: "MRR",
    description: "Monthly Recurring Revenue",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "arr",
    title: "ARR",
    description: "Annual Recurring Revenue",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "cashBalance",
    title: "Cash Balance",
    description: "Total cash on hand",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "burnRate",
    title: "Net Burn",
    description: "Monthly net cash burn",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "contracted",
    title: "Contracted",
    description: "Pipeline in negotiation/closed",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "grossMargin",
    title: "Gross Margin",
    description: "Revenue after COGS",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "netMargin",
    title: "Net Margin",
    description: "Income as % of sales",
    defaultEnabled: true,
    category: "core",
  },
  {
    id: "customers",
    title: "Customers",
    description: "Active customer count",
    defaultEnabled: true,
    category: "core",
  },

  // LTM Metrics
  {
    id: "ltmRevenue",
    title: "LTM Avg Revenue",
    description: "Last 12 months avg monthly revenue",
    defaultEnabled: true,
    category: "ltm",
  },
  {
    id: "burnRateLTM",
    title: "LTM Avg Burn",
    description: "Last 12 months avg monthly burn",
    defaultEnabled: false,
    category: "ltm",
  },
  {
    id: "burnVariance",
    title: "Burn vs LTM",
    description: "Current burn vs LTM average (%)",
    defaultEnabled: false,
    category: "ltm",
  },

  // Advanced Metrics
  {
    id: "cac",
    title: "CAC",
    description: "Customer Acquisition Cost",
    defaultEnabled: false,
    category: "advanced",
  },
  {
    id: "ltv",
    title: "LTV",
    description: "Customer Lifetime Value",
    defaultEnabled: false,
    category: "advanced",
  },
  {
    id: "churn",
    title: "Churn Rate",
    description: "Monthly customer churn %",
    defaultEnabled: false,
    category: "advanced",
  },
  {
    id: "nps",
    title: "NPS",
    description: "Net Promoter Score",
    defaultEnabled: false,
    category: "advanced",
  },
  {
    id: "runway",
    title: "Runway",
    description: "Months of cash runway",
    defaultEnabled: false,
    category: "advanced",
  },
  {
    id: "quickRatio",
    title: "Quick Ratio",
    description: "Growth efficiency metric",
    defaultEnabled: false,
    category: "advanced",
  },
];

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

  const handleToggleMetric = (metricId: string) => {
    setTempSelection((prev) =>
      prev.includes(metricId)
        ? prev.filter((id) => id !== metricId)
        : [...prev, metricId]
    );
  };

  const handleSave = () => {
    onMetricsChange(tempSelection);
    setOpen(false);
  };

  const handleCancel = () => {
    setTempSelection(selectedMetrics);
    setOpen(false);
  };

  const getCategoryMetrics = (category: string) => {
    return availableMetrics.filter((metric) => metric.category === category);
  };

  const recommendedKpis = businessType
    ? (KPI_TEMPLATES[businessType] ?? [])
    : [];

  const renderRecommendedKpis = () => {
    if (!recommendedKpis.length) return null;

    return (
      <div className="space-y-3">
        <div>
          <h4 className="font-medium text-sm">
            Recommended KPIs for Your Business
          </h4>
          <p className="text-xs text-muted-foreground">
            Based on your business type, these KPIs are highly relevant
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3">
          {recommendedKpis.map((kpi) => {
            const isSelected = tempSelection.includes(kpi.id);
            return (
              <Card
                key={kpi.id}
                className={`cursor-pointer transition-all ${
                  isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
                onClick={() => handleToggleMetric(kpi.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-sm">{kpi.label}</CardTitle>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                        Recommended
                      </span>
                    </div>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleToggleMetric(kpi.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-muted-foreground">
                    {kpi.description}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {kpi.trendGoal === "increase"
                      ? "↑ Higher is better"
                      : kpi.trendGoal === "decrease"
                        ? "↓ Lower is better"
                        : "→ Keep stable"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    );
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
          {/* Recommended KPIs section */}
          {renderRecommendedKpis()}

          {/* Existing categories */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {renderMetricCategory(
              "Core Metrics",
              "core",
              "Essential KPIs for tracking business performance"
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
