// lib/types/metric.ts
// Types for metrics from the database

export interface Metric {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category: "core" | "ltm" | "advanced";
  created_at: string;
  updated_at: string;
}

// For backward compatibility with existing MetricOption interface in metric-selector.tsx
export interface MetricOption {
  id: string; // This will be the slug for backward compatibility
  title: string;
  description: string;
  category?: "core" | "ltm" | "advanced";
}

// Mapping function to convert database Metric to MetricOption
export function metricToMetricOption(metric: Metric): MetricOption {
  return {
    id: metric.slug, // Use slug as id for backward compatibility
    title: metric.name,
    description: metric.description || "",
    category: metric.category,
  };
}

// Mapping function to convert MetricOption to Metric (for when we need the full metric object)
export function metricOptionToMetric(
  option: MetricOption,
  metricId: string
): Metric {
  return {
    id: metricId,
    slug: option.id,
    name: option.title,
    description: option.description,
    category: option.category || "core",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
