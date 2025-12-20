"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight } from "lucide-react";
import DataModelBuilder from "@/components/dashboard/DataModelBuilder";
import { markOnboardingComplete } from "@/lib/onboarding-status";

export default function OnboardingModelPage() {
  const router = useRouter();

  const handleFinish = async () => {
    // Mark onboarding as complete
    await markOnboardingComplete();
    // Redirect to dashboard
    router.push("/dashboard");
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
        <Button type="button" onClick={handleFinish}>
          Finish Onboarding
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </main>
  );
}
