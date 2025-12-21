"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Target, FileText, Upload, ArrowRight } from "lucide-react";

export default function OnboardingRequiredPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [attempts, setAttempts] = useState(0);
  const maxAttempts = 5;
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const checkOnboardingStatus = async () => {
      try {
        console.log(
          `[OnboardingRequired] Checking status (attempt ${attempts + 1}/${maxAttempts})...`
        );
        const { isOnboardingComplete } =
          await import("@/lib/onboarding-status");
        const complete = await isOnboardingComplete();
        if (complete) {
          console.log(
            "[OnboardingRequired] Status is completed, redirecting to dashboard..."
          );
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
          // If onboarding is complete, redirect to dashboard with hard navigation
          window.location.href = "/dashboard";
        } else {
          setLoading(false);
          setAttempts((prev) => prev + 1);

          // Stop checking after max attempts
          if (attempts + 1 >= maxAttempts) {
            console.log(
              "[OnboardingRequired] Max attempts reached, stopping checks"
            );
            if (intervalRef.current) {
              clearInterval(intervalRef.current);
            }
          }
        }
      } catch (err) {
        console.error("Error checking onboarding status:", err);
        setLoading(false);
        setAttempts((prev) => prev + 1);

        if (attempts + 1 >= maxAttempts) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
          }
        }
      }
    };

    // Check immediately
    checkOnboardingStatus();

    // Then check every 5 seconds, but only if we haven't hit max attempts
    if (attempts < maxAttempts) {
      intervalRef.current = setInterval(checkOnboardingStatus, 5000);
    }

    // Cleanup on unmount
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [attempts, router]);

  // Don't show separate loading screen, show it inline instead

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full border-2 border-primary/20 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="flex justify-center mb-4">
            <div className="rounded-full bg-primary/10 p-4">
              {loading ? (
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
              ) : (
                <Sparkles className="h-12 w-12 text-primary" />
              )}
            </div>
          </div>
          <CardTitle className="text-2xl md:text-3xl mb-2">
            {loading ? "Checking Status..." : "Complete Your Onboarding"}
          </CardTitle>
          <CardDescription className="text-base">
            {loading
              ? `Verifying your onboarding status (${attempts}/${maxAttempts})...`
              : "Get started by setting up your company profile and selecting your KPIs"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-1.5 mt-0.5">
                <Target className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Set up your company</h3>
                <p className="text-sm text-muted-foreground">
                  Tell us about your business to get personalized insights
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-1.5 mt-0.5">
                <FileText className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Select your KPIs</h3>
                <p className="text-sm text-muted-foreground">
                  Choose the metrics that matter most to your business
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-primary/10 p-1.5 mt-0.5">
                <Upload className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">Upload your data</h3>
                <p className="text-sm text-muted-foreground">
                  Connect your financial data to start tracking performance
                </p>
              </div>
            </div>
          </div>
          {!loading && (
            <div className="pt-4">
              <Button
                onClick={() => router.push("/onboarding")}
                className="w-full h-12 text-base"
                size="lg"
              >
                Start Onboarding
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
