"use client";
import { createClient } from "@/lib/supabase/client";

/**
 * Check if company onboarding is complete
 * Onboarding is complete when kpi_profiles exists for the company
 */
export async function isOnboardingComplete(): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    // Get company for user
    const { data: company, error: companyError } = await supabase
      .from("companies")
      .select("id")
      .eq("created_by", user.id)
      .single();

    if (companyError || !company) {
      // No company found - definitely not onboarded
      return false;
    }

    // Check if kpi_profiles exists for this company (onboarding complete)
    const { data: kpiProfile, error: kpiError } = await supabase
      .from("kpi_profiles")
      .select("id")
      .eq("company_id", company.id)
      .maybeSingle();

    // If error or no profile found, onboarding is not complete
    if (kpiError || !kpiProfile) {
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return false;
  }
}
