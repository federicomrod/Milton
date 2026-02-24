"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import MiltonChat from "@/app/onboarding/components/MiltonChat";
import { updateOnboardingStatus } from "@/lib/onboarding-status";
import { completeOnboardingChat } from "@/lib/onboarding-chat-service";

export default function OnboardingChatPage() {
  const [isReady, setIsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [miltonMessages, setMiltonMessages] = useState<
    { from: "milton" | "user"; text: string }[]
  >([]);
  const router = useRouter();

  // Check if onboarding is already complete and set initial status
  useEffect(() => {
    // Show chat immediately, check status in background
    setIsReady(true);

    const checkOnboardingStatus = async () => {
      try {
        const { getOnboardingStatus } = await import("@/lib/onboarding-status");
        const status = await getOnboardingStatus();

        if (status === "completed") {
          router.replace("/dashboard");
          return;
        }

        // Set status to "chat" if not started (only once) - fire and forget
        if (status === "not_started") {
          updateOnboardingStatus("chat").catch(console.error);
        }
      } catch (err) {
        console.error("Error checking onboarding status:", err);
      }
    };

    // Check in background, don't block rendering
    checkOnboardingStatus();
  }, [router]);

  const handleOnboardingFinish = useCallback(
    async (answers: {
      industry: string;
      employees: string;
      goals: string;
      revenue: string;
      dataSources: string;
      systems: string;
      businessContext?: string;
      businessDescription: string;
      businessType?: string;
      selectedDataCategories?: Record<string, "yes" | "no" | "not_sure">;
    }) => {
      console.log("🟩 Onboarding chat finished with answers:", answers);
      setLoading(true);
      setError(null);

      setMiltonMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "Analyzing your business to create a tailored data model...",
        },
      ]);

      try {
        // Call the AI business model analyzer with ALL answers
        const response = await fetch("/api/ai/business-model-analyzer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: {
              businessType: answers.businessType, // Don't default to "general" - let AI determine if missing
              businessTypeLabel: answers.industry,
              employees: answers.employees,
              goals: answers.goals,
              revenue: answers.revenue,
              dataSources: answers.dataSources,
              systems: answers.systems,
              selectedDataCategories: answers.selectedDataCategories,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(
            errorData.error || `Analysis failed: ${response.status}`
          );
        }

        const result = await response.json();
        console.log("✅ AI analysis complete:", result);

        if (!result.success) {
          throw new Error(result.error || "Analysis failed");
        }

        // Store the model in localStorage for the data model builder
        if (result.proposal) {
          localStorage.setItem("milton-model", JSON.stringify(result.proposal));
        }

        // Archive chat and redirect to upload page
        await completeOnboardingChat();
        await updateOnboardingStatus("upload");

        setMiltonMessages((prev) => [
          ...prev,
          {
            from: "milton",
            text: `✅ I've analyzed your business. Let's upload your data to get started!`,
          },
        ]);

        setTimeout(() => {
          router.push("/onboarding/upload");
        }, 1500);
      } catch (err) {
        console.error("Error in business analysis:", err);
        setError(err instanceof Error ? err.message : "Analysis failed");
        setMiltonMessages((prev) => [
          ...prev,
          {
            from: "milton",
            text: `⚠️ ${err instanceof Error ? err.message : "Something went wrong. Please try again."}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [router]
  );

  // Memoize MiltonChat to prevent re-renders
  const memoizedMiltonChat = useMemo(
    () => (
      <MiltonChat
        onFinish={handleOnboardingFinish}
        messages={miltonMessages}
        setMessages={setMiltonMessages}
      />
    ),
    [handleOnboardingFinish, miltonMessages]
  );

  // Show loading until we've verified auth and onboarding status
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
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <div className="w-full border-r border-border bg-card shadow-sm flex flex-col h-full overflow-hidden">
        <div className="flex-1 overflow-hidden min-h-0 p-4 md:p-6 flex items-center justify-center">
          {memoizedMiltonChat}
        </div>
      </div>

      {error && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 bg-destructive/10 border border-destructive/20 text-destructive p-4 rounded-lg shadow-lg z-50">
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
}
