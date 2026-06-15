"use client";

// Restaurant pivot: the legacy "complete your onboarding" wall is retired for
// the restaurant pilot. The old onboarding (business-type chat, KPI selection,
// model builder) does not exist in the restaurant product. Any authenticated
// user who lands here is either:
//   a) A restaurant pilot user who hit a proxy gap   → send to cockpit
//   b) An unauthenticated visitor                    → send to login
//
// The "check onboarding_status" polling loop is removed because:
//   - bootstrap_restaurant_user creates companies WITHOUT the created_by column
//     that the status query used, so the check always fails for restaurant users
//   - There is no restaurant onboarding flow to direct them towards anyway
//
// Legacy content (card UI, step list) is preserved as a comment below in case
// the non-restaurant product needs it restored later.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function OnboardingRequiredPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          // Unauthenticated — send to login
          router.replace("/auth/login");
          return;
        }

        // Authenticated (restaurant pilot or any user): send to restaurant cockpit.
        // The cockpit is the product home for the active pilot and is always
        // safe to land on for authenticated users.
        router.replace("/dashboard/restaurant");
      } catch (err) {
        console.error("[onboarding-required] Auth check failed:", err);
        // Fallback: send to login if we can't determine auth state
        router.replace("/auth/login");
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  // Minimal loading state — user sees this for at most one render cycle
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="text-center">
        <div
          className={
            checking
              ? "animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"
              : "rounded-full h-8 w-8 mx-auto mb-4"
          }
        />
        <p className="text-muted-foreground text-sm">Redirecting…</p>
      </div>
    </div>
  );
}

/*
 * ── Legacy onboarding wall (kept for reference) ─────────────────────────────
 *
 * The original page showed:
 *   <CardTitle>Complete Your Onboarding</CardTitle>
 *   • Set up your company
 *   • Select your KPIs
 *   • Upload your data
 *   <Button onClick={() => router.push("/onboarding")}>Start Onboarding</Button>
 *
 * It polled isOnboardingComplete() every 5 s (up to 5 attempts) and redirected
 * to /dashboard if the status flipped to "completed".
 *
 * To restore: git show HEAD~:app/onboarding-required/page.tsx
 * ────────────────────────────────────────────────────────────────────────────
 */
