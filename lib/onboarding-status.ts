"use client";
import { createClient } from "@/lib/supabase/client";

export type OnboardingStatus =
  | "not_started"
  | "chat"
  | "data_sources"
  | "kpi_selection"
  | "upload"
  | "model"
  | "completed";

/**
 * Get the current onboarding status for the user's company
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return "not_started";
    }

    const { data: company, error } = await supabase
      .from("companies")
      .select("onboarding_status")
      .eq("created_by", user.id)
      .single();

    if (error || !company) {
      return "not_started";
    }

    return (company.onboarding_status as OnboardingStatus) || "not_started";
  } catch (error) {
    console.error("Error getting onboarding status:", error);
    return "not_started";
  }
}

/**
 * Check if company onboarding is complete
 */
export async function isOnboardingComplete(): Promise<boolean> {
  const status = await getOnboardingStatus();
  return status === "completed";
}

/**
 * Update onboarding status for the current user's company
 */
export async function updateOnboardingStatus(
  status: OnboardingStatus
): Promise<boolean> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return false;
    }

    const { error } = await supabase
      .from("companies")
      .update({ onboarding_status: status })
      .eq("created_by", user.id);

    if (error) {
      console.error("Error updating onboarding status:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error updating onboarding status:", error);
    return false;
  }
}

/**
 * Mark onboarding as complete for the current user's company
 */
export async function markOnboardingComplete(): Promise<boolean> {
  return updateOnboardingStatus("completed");
}
