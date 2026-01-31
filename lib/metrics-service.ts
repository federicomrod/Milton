// lib/metrics-service.ts
// Service functions for interacting with the metrics table

import { createClient } from "@/lib/supabase/client";
import { Metric, metricToMetricOption } from "@/lib/types/metric";

/**
 * Fetch all metrics from the database
 */
export async function getAllMetrics(): Promise<Metric[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("metrics")
      .select("*")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[getAllMetrics] error:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("[getAllMetrics] unexpected error:", err);
    return [];
  }
}

/**
 * Fetch metrics by category
 */
export async function getMetricsByCategory(
  category: string
): Promise<Metric[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("metrics")
      .select("*")
      .eq("category", category)
      .order("name", { ascending: true });

    if (error) {
      console.error("[getMetricsByCategory] error:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("[getMetricsByCategory] unexpected error:", err);
    return [];
  }
}

/**
 * Fetch specific metrics by their UUIDs
 */
export async function getMetricsByIds(ids: string[]): Promise<Metric[]> {
  if (!ids || ids.length === 0) {
    return [];
  }

  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("metrics")
      .select("*")
      .in("id", ids);

    if (error) {
      console.error("[getMetricsByIds] error:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("[getMetricsByIds] unexpected error:", err);
    return [];
  }
}

/**
 * Fetch metrics for a specific business type (from template's suggested_metrics)
 */
export async function getSuggestedMetricsForBusinessType(
  businessTypeKey: string
): Promise<Metric[]> {
  try {
    const supabase = createClient();

    // First get the template
    const { data: template, error: templateError } = await supabase
      .from("business_model_templates")
      .select("suggested_metrics")
      .eq("key", businessTypeKey)
      .single();

    if (templateError || !template) {
      console.error(
        "[getSuggestedMetricsForBusinessType] template error:",
        templateError
      );
      return [];
    }

    const metricIds = template.suggested_metrics as string[];
    if (!metricIds || metricIds.length === 0) {
      return [];
    }

    // Then get the metrics
    return await getMetricsByIds(metricIds);
  } catch (err) {
    console.error(
      "[getSuggestedMetricsForBusinessType] unexpected error:",
      err
    );
    return [];
  }
}

/**
 * Get company metrics (from business_models.metrics)
 */
export async function getCompanyMetrics(companyId: string): Promise<Metric[]> {
  try {
    const supabase = createClient();

    // Get the business model for this company
    const { data: businessModel, error: businessModelError } = await supabase
      .from("business_models")
      .select("metrics")
      .eq("company_id", companyId)
      .single();

    if (businessModelError || !businessModel) {
      console.error(
        "[getCompanyMetrics] business model error:",
        businessModelError
      );
      return [];
    }

    const metricIds = businessModel.metrics as string[];
    if (!metricIds || metricIds.length === 0) {
      return [];
    }

    // Then get the metrics
    return await getMetricsByIds(metricIds);
  } catch (err) {
    console.error("[getCompanyMetrics] unexpected error:", err);
    return [];
  }
}

/**
 * Update company metrics (save selected metric UUIDs to business_models.metrics)
 */
export async function updateCompanyMetrics(
  companyId: string,
  metricIds: string[]
): Promise<boolean> {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from("business_models")
      .update({ metrics: metricIds })
      .eq("company_id", companyId);

    if (error) {
      console.error("[updateCompanyMetrics] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[updateCompanyMetrics] unexpected error:", err);
    return false;
  }
}

/**
 * Get available metrics for company customization (from template's suggested_metrics)
 * Falls back to all metrics if no business model exists
 */
export async function getAvailableMetricsForCompany(
  companyId: string
): Promise<Metric[]> {
  try {
    const supabase = createClient();

    // Get the business model and its business_type
    const { data: businessModel, error: businessModelError } = await supabase
      .from("business_models")
      .select("business_type")
      .eq("company_id", companyId)
      .single();

    if (businessModelError || !businessModel || !businessModel.business_type) {
      console.log(
        "[getAvailableMetricsForCompany] No business model found, returning all metrics"
      );
      // Fall back to all metrics if no business model exists
      return await getAllMetrics();
    }

    // Get suggested metrics for this business type
    return await getSuggestedMetricsForBusinessType(
      businessModel.business_type
    );
  } catch (err) {
    console.error("[getAvailableMetricsForCompany] unexpected error:", err);
    // Fall back to all metrics on error
    return await getAllMetrics();
  }
}
