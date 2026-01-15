"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DataSourceSelectionStep } from "@/components/onboarding/DataSourceSelectionStep";
import { getOnboardingStatus } from "@/lib/onboarding-status";

export default function OnboardingDataSourcesPage() {
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

        // If user hasn't completed chat or KPI selection, redirect them back
        if (status === "not_started" || status === "chat") {
          router.replace("/onboarding/chat");
          return;
        }
        if (status === "kpi_selection") {
          router.replace("/onboarding/kpi-selection");
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

  const handleComplete = () => {
    router.push("/onboarding/model");
  };

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
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-4xl py-8 px-4 space-y-6">
        <DataSourceSelectionStep onComplete={handleComplete} />
        <div className="flex justify-start">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/onboarding/kpi-selection")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}
