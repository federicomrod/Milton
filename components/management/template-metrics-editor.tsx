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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Metric {
  id: string;
  slug: string;
  name: string;
  description?: string;
  category: "core" | "ltm" | "advanced";
}

interface TemplateMetricsEditorProps {
  selectedMetricIds: string[];
  onChange: (metricIds: string[]) => void;
}

export function TemplateMetricsEditor({
  selectedMetricIds,
  onChange,
}: TemplateMetricsEditorProps) {
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch("/api/admin/metrics");
        if (response.ok) {
          const data = await response.json();
          setMetrics(data);
        }
      } catch (error) {
        console.error("Failed to fetch metrics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, []);

  const toggleMetric = (metricId: string) => {
    if (selectedMetricIds.includes(metricId)) {
      onChange(selectedMetricIds.filter((id) => id !== metricId));
    } else {
      onChange([...selectedMetricIds, metricId]);
    }
  };

  const filterByCategory = (category: string) => {
    return metrics.filter((m) => m.category === category);
  };

  const renderMetricsList = (metricsToShow: Metric[]) => {
    if (metricsToShow.length === 0) {
      return (
        <p className="text-sm text-muted-foreground text-center py-4">
          No metrics in this category
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {metricsToShow.map((metric) => (
          <label
            key={metric.id}
            className="flex items-start space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-accent transition-colors"
          >
            <Checkbox
              checked={selectedMetricIds.includes(metric.id)}
              onCheckedChange={() => toggleMetric(metric.id)}
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{metric.name}</span>
                <Badge variant="outline" className="text-xs">
                  {metric.category}
                </Badge>
              </div>
              {metric.description && (
                <p className="text-sm text-muted-foreground mt-1">
                  {metric.description}
                </p>
              )}
              <code className="text-xs text-muted-foreground mt-1">
                {metric.slug}
              </code>
            </div>
          </label>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Loading metrics...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested Metrics</CardTitle>
        <CardDescription>
          Select metrics to suggest for this business model template
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="all" className="space-y-4">
          <TabsList>
            <TabsTrigger value="all">All ({metrics.length})</TabsTrigger>
            <TabsTrigger value="core">
              Core ({filterByCategory("core").length})
            </TabsTrigger>
            <TabsTrigger value="ltm">
              LTM ({filterByCategory("ltm").length})
            </TabsTrigger>
            <TabsTrigger value="advanced">
              Advanced ({filterByCategory("advanced").length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all">{renderMetricsList(metrics)}</TabsContent>

          <TabsContent value="core">
            {renderMetricsList(filterByCategory("core"))}
          </TabsContent>

          <TabsContent value="ltm">
            {renderMetricsList(filterByCategory("ltm"))}
          </TabsContent>

          <TabsContent value="advanced">
            {renderMetricsList(filterByCategory("advanced"))}
          </TabsContent>
        </Tabs>

        <div className="mt-4 pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            {selectedMetricIds.length} metric(s) selected
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
