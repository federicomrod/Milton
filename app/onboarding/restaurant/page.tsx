// app/onboarding/restaurant/page.tsx
//
// Restaurant onboarding entry point — replaces the old startup-CFO
// onboarding for restaurant-pivot signups. Server component: resolves the
// authenticated user + company + restaurant name (already collected at
// signup, never re-asked), then hands off to the client wizard.
//
// This route lives under /onboarding, which proxy.ts already treats as a
// public prefix (no middleware auth redirect), so auth is handled here
// directly — same pattern the rest of the restaurant API routes use via
// authAndCompany(), adapted for a page (redirect() instead of a JSON 401).

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveCompanyIdForUser } from "@/lib/restaurant/supabase-sales";
import { RestaurantOnboardingWizard } from "@/components/restaurant/onboarding/RestaurantOnboardingWizard";

export const dynamic = "force-dynamic";

export default async function RestaurantOnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const companyId = await resolveCompanyIdForUser(supabase, user.id);
  if (!companyId) {
    // Shouldn't happen post-signup (bootstrap_restaurant_user always
    // creates a membership), but fail safe rather than crash the page.
    redirect("/auth/login");
  }

  const { data: company } = await supabase
    .from("companies")
    .select("name")
    .eq("id", companyId)
    .maybeSingle();

  const restaurantName = company?.name || "your restaurant";

  return <RestaurantOnboardingWizard restaurantName={restaurantName} />;
}
