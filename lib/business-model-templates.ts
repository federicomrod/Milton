// lib/business-model-templates.ts
// Fetch business model templates from Supabase

import { createClient } from "@/lib/supabase/client";

export interface BusinessModelTemplate {
  id?: string;
  key?: string; // Some tables use 'key' as primary key
  name: string;
  description?: string;
  tagline?: string;
  kpi_recipes: any[];
  created_at?: string;
  updated_at?: string;
}

export interface BusinessTypeDefinition {
  id: string;
  label: string;
  shortLabel?: string;
  description: string;
  tagline?: string;
}

/**
 * Fetch all business model templates from Supabase
 */
export async function getBusinessModelTemplates(): Promise<
  BusinessTypeDefinition[]
> {
  try {
    const supabase = createClient();
    // Fetch templates - try both 'id' and 'key' column names to support different table structures
    const { data, error } = await supabase
      .from("business_model_templates")
      .select("*")
      .order("name");

    if (error) {
      console.error("[getBusinessModelTemplates] error:", error);
      // Fallback to default types if fetch fails
      return getDefaultBusinessTypes();
    }

    if (!data || data.length === 0) {
      return getDefaultBusinessTypes();
    }

    // Map Supabase data to BusinessTypeDefinition format
    return data.map((template: any) => {
      // Support both 'id' and 'key' as primary key column names
      const id = template.id || template.key || "";
      return {
        id,
        label: template.name || id,
        shortLabel: id.split("_")[0],
        description: template.description || "",
        tagline: template.tagline || "",
      };
    });
  } catch (err) {
    console.error("[getBusinessModelTemplates] unexpected error:", err);
    return getDefaultBusinessTypes();
  }
}

/**
 * Fallback default business types if Supabase fetch fails
 */
function getDefaultBusinessTypes(): BusinessTypeDefinition[] {
  return [
    {
      id: "saas",
      label: "SaaS / Digital Product",
      shortLabel: "SaaS",
      description:
        "Subscription-based or digital product businesses with recurring revenue and pipelines.",
      tagline: "MRR, churn, pipeline, CAC & LTV.",
    },
    {
      id: "agency",
      label: "Agency / Service Business",
      shortLabel: "Agency",
      description:
        "Consulting, marketing, training, or professional services with projects and retainers.",
      tagline: "Projects, invoices, utilization & margin.",
    },
    {
      id: "fitness_studio",
      label: "Fitness / Wellness Studio",
      shortLabel: "Fitness",
      description:
        "Yoga, pilates, and fitness studios with classes, bookings, instructors and packs.",
      tagline: "Class utilization, pack sales & cancellations.",
    },
  ];
}
