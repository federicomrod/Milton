"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import {
  markOnboardingComplete,
  getOnboardingStatus,
} from "@/lib/onboarding-status";

export default function OnboardingModelPage() {
  const router = useRouter();
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      console.log("[Model] Starting to mark onboarding as complete...");

      // Mark onboarding as complete
      const success = await markOnboardingComplete();

      if (!success) {
        console.error("[Model] Failed to mark onboarding as complete");
        alert("Failed to complete onboarding. Please try again.");
        setIsFinishing(false);
        return;
      }

      console.log("[Model] Onboarding marked as complete, verifying...");

      // Verify the status was actually updated by re-fetching
      let verified = false;
      let attempts = 0;
      const maxAttempts = 5;

      while (!verified && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const status = await getOnboardingStatus();
        console.log(
          `[Model] Verification attempt ${attempts + 1}: status = ${status}`
        );

        if (status === "completed") {
          verified = true;
          console.log("[Model] Status verified as completed!");
        }
        attempts++;
      }

      if (!verified) {
        console.error(
          "[Model] Could not verify onboarding completion after",
          maxAttempts,
          "attempts"
        );
        alert(
          "Onboarding may not have completed properly. Please contact support if you continue to have issues."
        );
        setIsFinishing(false);
        return;
      }

      // Status is confirmed - redirect to dashboard with hard navigation
      // Use window.location to force a full page reload and clear any caching
      console.log("[Model] Redirecting to dashboard...");
      window.location.href = "/dashboard";
    } catch (error) {
      console.error("[Model] Error completing onboarding:", error);
      alert("An error occurred. Please try again.");
      setIsFinishing(false);
    }
  };

  return (
    <main className="min-h-screen bg-background max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Customize Your Data Model</h1>
        <p className="text-sm text-muted-foreground">
          Review and customize your data model. You can adjust tables, fields,
          and relationships to match your business needs.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <DataModelBuilder isOnboarding={true} />
      </div>

      <div className="flex justify-between items-center pt-6 border-t border-border">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/onboarding/upload")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button type="button" onClick={handleFinish} disabled={isFinishing}>
          {isFinishing ? "Completing..." : "Finish Onboarding"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </main>
  );
}
