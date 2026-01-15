// lib/kpi-recipe-service.ts
import { createClient } from "@/lib/supabase/client";

/**
 * Loads selected KPIs for a company from business_models.selected_kpi_ids.
 *
 * Fetches the selected KPI IDs from the business_models table and returns
 * the corresponding KPI records from the kpis table.
 *
 * @param companyId - The company ID to fetch selected KPIs for
 * @returns Array of KPI objects from the kpis table
 */
export async function getSelectedKpis(companyId: string) {
  try {
    const supabase = createClient();

    // Fetch the business model to get selected_kpi_ids
    const { data: businessModel, error: modelError } = await supabase
      .from("business_models")
      .select("selected_kpi_ids")
      .eq("company_id", companyId)
      .single();

    if (modelError) {
      console.error(
        "[getSelectedKpis] Error fetching business model:",
        modelError
      );
      return [];
    }

    if (
      !businessModel ||
      !businessModel.selected_kpi_ids ||
      !Array.isArray(businessModel.selected_kpi_ids)
    ) {
      console.log("[getSelectedKpis] No selected KPIs found for company");
      return [];
    }

    const kpiIds = businessModel.selected_kpi_ids as string[];

    // If no KPIs are selected, return empty array
    if (kpiIds.length === 0) {
      return [];
    }

    // Fetch KPIs from the separate kpis table
    const { data: kpis, error: kpisError } = await supabase
      .from("kpis")
      .select("*")
      .in("id", kpiIds);

    if (kpisError) {
      console.error("[getSelectedKpis] Error fetching KPIs:", kpisError);
      return [];
    }

    return kpis || [];
  } catch (err) {
    console.error("[getSelectedKpis] Unexpected error:", err);
    return [];
  }
}

/**
 * Loads KPIs for a given business model template.
 *
 * Fetches the list of KPI IDs from the business_model_templates table
 * and returns the corresponding KPI records from the kpis table.
 *
 * @deprecated Use getSelectedKpis instead - we now use selected_kpi_ids from business_models
 * @param modelKey - The business model template key (e.g., "saas", "agency")
 * @returns Array of KPI objects from the kpis table
 */
export async function getKpiRecipes(modelKey: string) {
  try {
    const supabase = createClient();

    // Normalize business type to try different formats
    const normalizeBusinessType = (type: string): string[] => {
      const variants = [
        type,
        type.toLowerCase().replace(/\s+/g, "_"),
        type.toLowerCase().replace(/\s+/g, "-"),
        type.toLowerCase(),
      ];
      return Array.from(new Set(variants));
    };

    const businessTypeVariants = normalizeBusinessType(modelKey);
    let templateData = null;

    // Try multiple business type formats
    for (const variant of businessTypeVariants) {
      const { data, error } = await supabase
        .from("business_model_templates")
        .select("kpi_ids")
        .eq("key", variant)
        .limit(1)
        .single();

      if (!error && data) {
        templateData = data;
        break;
      }
    }

    if (
      !templateData ||
      !templateData.kpi_ids ||
      !Array.isArray(templateData.kpi_ids)
    ) {
      return [];
    }

    const kpiIds = templateData.kpi_ids;

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
