"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import { markOnboardingComplete } from "@/lib/onboarding-status";

export default function OnboardingModelPage() {
  const router = useRouter();
  const [isFinishing, setIsFinishing] = useState(false);

  const handleFinish = async () => {
    setIsFinishing(true);
    try {
      // Mark onboarding as complete
      const success = await markOnboardingComplete();

      if (!success) {
        console.error("Failed to mark onboarding as complete");
        setIsFinishing(false);
        return;
      }

      // Wait a moment to ensure database update propagates
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Redirect to dashboard
      router.push("/dashboard");
    } catch (error) {
      console.error("Error completing onboarding:", error);
      setIsFinishing(false);
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
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

      <div className="flex justify-between items-center pt-6 border-t">
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
