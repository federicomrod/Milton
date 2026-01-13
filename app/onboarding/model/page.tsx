"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import { updateOnboardingStatus } from "@/lib/onboarding-status";

export default function OnboardingModelPage() {
  const router = useRouter();
  const [isFinishing, setIsFinishing] = useState(false);

  const handleContinue = async () => {
    setIsFinishing(true);
    try {
      console.log("[Model] Completing onboarding...");

      // Mark onboarding as complete
      const { markOnboardingComplete } =
        await import("@/lib/onboarding-status");
      const success = await markOnboardingComplete();

      if (!success) {
        console.error("[Model] Failed to update onboarding status");
        alert("Failed to continue. Please try again.");
        setIsFinishing(false);
        return;
      }

      // Redirect to dashboard
      console.log("[Model] Redirecting to dashboard...");
      router.push("/dashboard");
    } catch (error) {
      console.error("[Model] Error continuing onboarding:", error);
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
          onClick={() => router.push("/onboarding/data-sources")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button type="button" onClick={handleContinue} disabled={isFinishing}>
          {isFinishing ? "Completing..." : "Finish Onboarding"}
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </main>
  );
}
