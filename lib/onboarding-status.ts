"use client";
import { createClient } from "@/lib/supabase/client";

/**
 * Check if company onboarding is complete
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

    // Get company for user and check onboarding_completed flag
    const { data: company, error } = await supabase
      .from("companies")
      .select("onboarding_completed")
      .eq("created_by", user.id)
      .single();

    if (error || !company) {
      return false;
    }

    return company.onboarding_completed === true;
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return false;
  }
}

/**
 * Mark onboarding as complete for the current user's company
 */
export async function markOnboardingComplete(): Promise<boolean> {
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
      .update({ onboarding_completed: true })
      .eq("created_by", user.id);

    if (error) {
      console.error("Error marking onboarding complete:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error marking onboarding complete:", error);
    return false;
  }
}
