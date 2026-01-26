"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { KpiSelectionStep } from "@/components/onboarding/KpiSelectionStep";
import { getOnboardingStatus } from "@/lib/onboarding-status";

export default function OnboardingKpisPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const status = await getOnboardingStatus();

        if (status === "completed") {
          router.replace("/dashboard");
          return;
        }

        // If user hasn't completed chat, redirect them back
        if (status === "not_started") {
          router.replace("/onboarding/chat");
          return;
        }

        setIsReady(true);
      } catch (err) {
        console.error("Error checking onboarding status:", err);
        setIsReady(true);
      }
    };

    checkOnboardingStatus();
  }, [router]);

  if (!isReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Choose your key KPIs</h1>
        <p className="text-sm text-muted-foreground">
          Based on your business type and the data you connected, Milton
          recommends a set of KPIs. Select the ones you care about most. You can
          always adjust them later in your dashboard settings.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <KpiSelectionStep redirectTo="/dashboard" />
      </div>

      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/onboarding/upload")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>
    </main>
  );
}
