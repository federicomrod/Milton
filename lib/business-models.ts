// lib/business-models.ts
// Business model operations and types

import { createClient } from "@/lib/supabase/client";

export interface BusinessModel {
  id: string;
  business_type: string | null;
  selected_kpi_ids: string[];
  model_json: Record<string, any>;
  onboarding_answers: Record<string, any>;
  company_id: string;
  data_readiness: Record<string, any>;
  data_sources: Record<string, any>;
  ranked_kpi_ids: string[];
  canonical_model: Record<string, any>;
  metrics: string[]; // UUIDs of selected metrics
  created_at: string;
  updated_at: string;
}

/**
 * Get business model for a company
 */
export async function getBusinessModelForCompany(
  companyId: string
): Promise<BusinessModel | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("business_models")
      .select("*")
      .eq("company_id", companyId)
      .single();

    if (error) {
      console.error("[getBusinessModelForCompany] error:", error);
      return null;
    }

    return data as BusinessModel;
  } catch (err) {
    console.error("[getBusinessModelForCompany] unexpected error:", err);
    return null;
  }
}

/**
 * Create a new business model for a company
 */
export async function createBusinessModel(
  companyId: string,
  businessType: string,
  initialMetrics?: string[]
): Promise<BusinessModel | null> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("business_models")
      .insert({
        company_id: companyId,
        business_type: businessType,
        metrics: initialMetrics || [],
        selected_kpi_ids: [],
        model_json: {},
        onboarding_answers: {},
        data_readiness: {},
        data_sources: {},
        ranked_kpi_ids: [],
        canonical_model: {},
      })
      .select()
      .single();

    if (error) {
      console.error("[createBusinessModel] error:", error);
      return null;
    }

    return data as BusinessModel;
  } catch (err) {
    console.error("[createBusinessModel] unexpected error:", err);
    return null;
  }
}

/**
 * Update business model metrics
 */
export async function updateBusinessModelMetrics(
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
      console.error("[updateBusinessModelMetrics] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[updateBusinessModelMetrics] unexpected error:", err);
    return false;
  }
}

/**
 * Update business model business type
 */
export async function updateBusinessModelBusinessType(
  companyId: string,
  businessType: string
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("business_models")
      .update({ business_type: businessType })
      .eq("company_id", companyId);

    if (error) {
      console.error("[updateBusinessModelBusinessType] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[updateBusinessModelBusinessType] unexpected error:", err);
    return false;
  }
}

/**
 * Update business model onboarding answers
 */
export async function updateBusinessModelOnboardingAnswers(
  companyId: string,
  answers: Record<string, any>
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("business_models")
      .update({ onboarding_answers: answers })
      .eq("company_id", companyId);

    if (error) {
      console.error("[updateBusinessModelOnboardingAnswers] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error(
      "[updateBusinessModelOnboardingAnswers] unexpected error:",
      err
    );
    return false;
  }
}

/**
 * Update business model canonical model (from template)
 */
export async function updateBusinessModelCanonicalModel(
  companyId: string,
  canonicalModel: Record<string, any>
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("business_models")
      .update({ canonical_model: canonicalModel })
      .eq("company_id", companyId);

    if (error) {
      console.error("[updateBusinessModelCanonicalModel] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[updateBusinessModelCanonicalModel] unexpected error:", err);
    return false;
  }
}

/**
 * Update business model data readiness
 */
export async function updateBusinessModelDataReadiness(
  companyId: string,
  dataReadiness: Record<string, any>
): Promise<boolean> {
  try {
    const supabase = createClient();
    const { error } = await supabase
      .from("business_models")
      .update({ data_readiness: dataReadiness })
      .eq("company_id", companyId);

    if (error) {
      console.error("[updateBusinessModelDataReadiness] error:", error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[updateBusinessModelDataReadiness] unexpected error:", err);
    return false;
  }
}
