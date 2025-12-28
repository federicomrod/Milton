// lib/business-model-templates.ts
// Fetch business model templates from Supabase

import { createClient } from "@/lib/supabase/client";

export interface BusinessModelTemplate {
  id?: string;
  key: string; // Primary key identifier (e.g., "saas", "agency")
  name: string;
  description?: string;
  // New structure fields
  required_tables_data?: any[]; // JSONB array of required tables/data sources
  required_relationships?: any[]; // JSONB array of required relationships
  kpi_ids?: string[]; // JSONB array of KPI IDs referencing separate KPIs table
  filters?: any[]; // JSONB array of filter definitions
  mvp_guardrails?: Record<string, any>; // JSONB object containing MVP guardrails
  data_categories?: any[]; // JSONB array of data categories
  created_at?: string;
  updated_at?: string;
}

export interface BusinessTypeDefinition {
  id: string;
  label: string;
  shortLabel?: string;
  description: string;
}

/**
 * Fetch all business model templates from Supabase
 */
export async function getBusinessModelTemplates(): Promise<
  BusinessTypeDefinition[]
> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("*")
      .order("name");

    if (error) {
      console.error("[getBusinessModelTemplates] error:", error);
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Map Supabase data to BusinessTypeDefinition format
    return data.map((template: any) => {
      const id = template.key || template.id || "";
      return {
        id,
        label: template.name || id,
        shortLabel: id.split("_")[0],
        description: template.description || "",
      };
    });
  } catch (err) {
    console.error("[getBusinessModelTemplates] unexpected error:", err);
    return [];
  }
}

/**
 * Fetch data categories for a specific business model template
 */
export async function getDataCategoriesForBusinessType(
  businessTypeKey: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("data_categories")
      .eq("key", businessTypeKey)
      .single();

    if (error) {
      console.error("[getDataCategoriesForBusinessType] error:", error);
      return [];
    }

    return data?.data_categories || [];
  } catch (err) {
    console.error("[getDataCategoriesForBusinessType] unexpected error:", err);
    return [];
  }
}
