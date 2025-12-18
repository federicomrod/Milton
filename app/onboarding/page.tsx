"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import MiltonChat from "@/app/onboarding/components/MiltonChat";
import { createClient } from "@/lib/supabase/client";
import { markOnboardingComplete } from "@/lib/onboarding-status";
import { completeOnboardingChat } from "@/lib/onboarding-chat-service";
import type { SuggestedKPI } from "@/lib/ai/business-model-analyzer-types";

type KPI = {
  name: string;
  description: string;
  category: string;
  priority?: string;
};

export default function OnboardingPage() {
  const [isReady, setIsReady] = useState(false);
  const [recommendedKPIs, setRecommendedKPIs] = useState<KPI[]>([]);
  const [selectedKPIs, setSelectedKPIs] = useState<KPI[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [miltonMessages, setMiltonMessages] = useState<
    { from: "milton" | "user"; text: string }[]
  >([]);
  const router = useRouter();

  // Check if onboarding is already complete (auth is handled by middleware)
  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        const { isOnboardingComplete } =
          await import("@/lib/onboarding-status");
        const complete = await isOnboardingComplete();
        if (complete) {
          router.replace("/dashboard");
        } else {
          setIsReady(true);
        }
      } catch (err) {
        console.error("Error checking onboarding status:", err);
        setIsReady(true);
      }
    };
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
      businessDescription: string;
      businessType?: string;
    }) => {
      console.log("🟩 Onboarding finished with answers:", answers);
      setLoading(true);
      setError(null);

      setMiltonMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "Analyzing your business to create a tailored data model and suggest KPIs...",
        },
      ]);

      // Store business type for dashboard
      if (answers.businessType) {
        localStorage.setItem("selectedUseCase", answers.businessType);
        localStorage.setItem("useCaseConfirmed", "true");
        localStorage.setItem("businessModel", answers.businessType);
      }

      try {
        // Call the AI business model analyzer with ALL answers
        const response = await fetch("/api/ai/business-model-analyzer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            answers: {
              businessType: answers.businessType || "general",
              businessTypeLabel: answers.industry,
              employees: answers.employees,
              goals: answers.goals,
              revenue: answers.revenue,
              dataSources: answers.dataSources,
              systems: answers.systems,
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

        // Use the AI-suggested KPIs
        if (result.suggestedKPIs && result.suggestedKPIs.length > 0) {
          const kpis: KPI[] = result.suggestedKPIs.map((kpi: SuggestedKPI) => ({
            name: kpi.name,
            description: kpi.description,
            category: kpi.category,
            priority: kpi.priority,
          }));
          setRecommendedKPIs(kpis);

          // Auto-select high priority KPIs
          const highPriority = kpis.filter((k) => k.priority === "high");
          setSelectedKPIs(highPriority);

          setMiltonMessages((prev) => [
            ...prev,
            {
              from: "milton",
              text: `✅ I've created a data model with ${result.proposal?.recommendedTables?.length || 0} tables and suggested ${kpis.length} KPIs based on your business.`,
            },
            {
              from: "milton",
              text: "Please review and select the KPIs you want to track. High-priority ones are pre-selected.",
            },
          ]);
        } else {
          // No KPIs suggested, archive chat, mark onboarding complete and redirect
          await completeOnboardingChat();
          await markOnboardingComplete();
          setMiltonMessages((prev) => [
            ...prev,
            {
              from: "milton",
              text: "✅ Business model created! Redirecting to your dashboard...",
            },
          ]);
          setTimeout(() => {
            router.push("/dashboard");
          }, 1500);
        }
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

  const toggleKPISelection = useCallback((kpi: KPI) => {
    setSelectedKPIs((prev) => {
      const isSelected = prev.some((k) => k.name === kpi.name);
      if (isSelected) {
        return prev.filter((k) => k.name !== kpi.name);
      } else {
        return [...prev, kpi];
      }
    });
  }, []);

  const finishOnboarding = useCallback(async () => {
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Get company for user
        const { data: company } = await supabase
          .from("companies")
          .select("id")
          .eq("created_by", user.id)
          .single();

        if (company) {
          // Save selected KPIs to the business_models table
          const { error: saveError } = await supabase
            .from("business_models")
            .update({
              selected_kpi_ids: selectedKPIs.map((k) => k.name),
            })
            .eq("company_id", company.id);

          if (saveError) {
            console.error("Failed to save KPIs to database:", saveError);
          }
        }
      }

      // Save to localStorage as backup
      localStorage.setItem("selectedKPIs", JSON.stringify(selectedKPIs));

      // Archive the completed conversation and mark onboarding complete
      await completeOnboardingChat();
      await markOnboardingComplete();

      setMiltonMessages((prev) => [
        ...prev,
        {
          from: "milton",
          text: "✅ All set! Redirecting to your dashboard...",
        },
      ]);

      setTimeout(() => {
        router.push("/dashboard");
      }, 1000);
    } catch (err) {
      console.error("Error finishing onboarding:", err);
      // Still try to redirect
      await completeOnboardingChat();
      await markOnboardingComplete();
      router.push("/dashboard");
    }
  }, [selectedKPIs, router]);

  const skipKPISelection = useCallback(async () => {
    // Archive chat and mark onboarding as complete even when skipping
    await completeOnboardingChat();
    await markOnboardingComplete();

    setMiltonMessages((prev) => [
      ...prev,
      {
        from: "milton",
        text: "No problem! You can always set up KPIs later. Redirecting...",
      },
    ]);
    setTimeout(() => {
      router.push("/dashboard");
    }, 1000);
  }, [router]);

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

  const showKpiPanel = recommendedKPIs.length > 0 && !loading;

  // Show loading until we've verified auth and onboarding status
  if (!isReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col md:flex-row bg-gradient-to-br from-gray-50 to-gray-100 overflow-hidden">
      {/* Main: Milton Chat */}
      <div
        className={`${showKpiPanel ? "md:w-3/5" : "w-full"} border-r bg-white shadow-sm flex flex-col h-full overflow-hidden`}
      >
        <div className="flex-1 overflow-hidden min-h-0 p-4 md:p-6 flex items-center justify-center">
          {memoizedMiltonChat}
        </div>
      </div>

      {/* Right: KPI Recommendation Panel */}
      {showKpiPanel && (
        <div className="md:w-2/5 p-6 md:p-8 flex flex-col bg-gray-50 overflow-auto border-t md:border-t-0 md:border-l">
          <Card className="p-6 w-full max-w-md mx-auto">
            {error ? (
              <>
                <h2 className="text-xl font-semibold mb-4 text-red-600">
                  Error
                </h2>
                <p className="text-gray-600 mb-4">{error}</p>
                <Button
                  onClick={() => {
                    setError(null);
                    setRecommendedKPIs([]);
                  }}
                  variant="outline"
                >
                  Try Again
                </Button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-semibold mb-2 text-gray-700">
                  Suggested KPIs
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                  Based on your business, here are the KPIs I recommend
                  tracking. Select at least 3.
                </p>

                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                  {recommendedKPIs.map((k, i) => {
                    const isSelected = selectedKPIs.some(
                      (sk) => sk.name === k.name
                    );
                    return (
                      <div
                        key={i}
                        onClick={() => toggleKPISelection(k)}
                        className={`cursor-pointer rounded-lg border p-3 transition-all ${
                          isSelected
                            ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                            : "border-gray-200 hover:border-gray-300 bg-white"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{k.name}</span>
                              {k.priority === "high" && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                                  High Priority
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              {k.description}
                            </div>
                          </div>
                          <div className="text-xs uppercase text-gray-400 ml-2">
                            {k.category}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 space-y-2">
                  <Button
                    className="w-full"
                    disabled={selectedKPIs.length < 3}
                    onClick={finishOnboarding}
                  >
                    {selectedKPIs.length < 3
                      ? `Select ${3 - selectedKPIs.length} more KPI${3 - selectedKPIs.length > 1 ? "s" : ""}`
                      : `Confirm ${selectedKPIs.length} KPIs`}
                  </Button>
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={skipKPISelection}
                  >
                    Skip for now
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
