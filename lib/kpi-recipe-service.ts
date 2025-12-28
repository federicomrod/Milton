// lib/kpi-recipe-service.ts
import { createClient } from "@/lib/supabase/client";

/**
 * Loads KPIs for a given business model template.
 *
 * Fetches the list of KPI IDs from the business_model_templates table
 * and returns the corresponding KPI records from the kpis table.
 *
 * @param modelKey - The business model template key (e.g., "saas", "agency")
 * @returns Array of KPI objects from the kpis table
 */
export async function getKpiRecipes(modelKey: string) {
  try {
    const supabase = createClient();

    // Fetch the business model template to get kpi_ids
    const { data: templateData, error: templateError } = await supabase
      .from("business_model_templates")
      .select("kpi_ids")
      .eq("key", modelKey)
      .limit(1)
      .single();

    if (templateError) {
      console.error("[getKpiRecipes] Error fetching template:", templateError);
      return [];
    }

    if (
      !templateData ||
      !templateData.kpi_ids ||
      !Array.isArray(templateData.kpi_ids)
    ) {
      return [];
    }

    const kpiIds = templateData.kpi_ids;

    // If no KPIs are associated with this template, return empty array
    if (kpiIds.length === 0) {
      return [];
    }

    // Fetch KPIs from the separate kpis table
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", kpiIds);

    if (kpisError) {
      console.error("[getKpiRecipes] Error fetching KPIs:", kpisError);
      return [];
    }

    return kpis || [];
  } catch (err) {
    console.error("[getKpiRecipes] Unexpected error:", err);
    return [];
  }
}
