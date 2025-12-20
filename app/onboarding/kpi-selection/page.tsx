"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { KpiSelectionStep } from "@/components/onboarding/KpiSelectionStep";

export default function OnboardingKpisPage() {
  const router = useRouter();

  return (
    <main className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Choose your key KPIs</h1>
        <p className="text-sm text-muted-foreground">
          Based on your business type and the data you connected, Milton
          recommends a set of KPIs. Select the ones you care about most. You can
          always adjust them later in your dashboard settings.
        </p>
      </div>

      <div className="rounded-2xl border bg-background p-4 md:p-6">
        <KpiSelectionStep redirectTo="/onboarding/upload" />
      </div>

      <div className="flex justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/onboarding/chat")}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </div>
    </main>
  );
}
