"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getOnboardingStatus } from "@/lib/onboarding-status";

export default function OnboardingPage() {
  const router = useRouter();

  // Redirect to the correct onboarding step based on status
  useEffect(() => {
    const redirectToCorrectStep = async () => {
      const status = await getOnboardingStatus();

      const redirectMap: Record<string, string> = {
        not_started: "/onboarding/chat",
        chat: "/onboarding/chat",
        kpi_selection: "/onboarding/kpi-selection",
        upload: "/onboarding/upload",
        model: "/onboarding/model",
        completed: "/dashboard",
      };

      const redirectPath = redirectMap[status] || "/onboarding/chat";
      router.replace(redirectPath);
    };

    redirectToCorrectStep();
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}
