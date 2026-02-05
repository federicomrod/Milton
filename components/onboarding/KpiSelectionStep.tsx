"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
// KPI templates removed - using database-driven KPIs instead
import {
  evaluateKpiAvailability,
  type KpiAvailability,
} from "@/lib/kpi-availability";

// Local interface for KPI templates (replacing removed KpiTemplate)
interface LocalKpiTemplate {
  id: string;
  label: string;
  description: string;
  category?: string;
  trendGoal: "increase" | "decrease" | "stable";
  formula?: string;
  priority?: "high" | "low";
}
import type { ModelProposal } from "@/lib/ai/business-model-analyzer-types";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type ApiState =
  | { status: "loading" }
  | {
      status: "ready";
      businessType: string;
      model: ModelProposal | null;
      selected: string[];
      recommendedKpis?: DatabaseKpi[];
      additionalKpis?: DatabaseKpi[];
    }
  | { status: "error"; message: string };

const MIN_SELECTED = 3;

interface KpiSelectionStepProps {
  redirectTo?: string;
}

export function KpiSelectionStep({
  redirectTo = "/dashboard",
}: KpiSelectionStepProps) {
  const router = useRouter();
  const [state, setState] = useState<ApiState>({ status: "loading" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [availabilities, setAvailabilities] = useState<KpiAvailability[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    // Use sessionStorage to cache the KPI data within the same session
    const cacheKey = "kpi-selection-cache";
    const cached = sessionStorage.getItem(cacheKey);

    if (cached) {
      try {
        const cachedData = JSON.parse(cached);
        const timestamp = cachedData.timestamp || 0;
        const cacheAge = Date.now() - timestamp;
        // Cache for 5 minutes (300000ms)
        if (cacheAge < 300000) {
          console.log("[KpiSelectionStep] Using cached KPI data");
          // Use cached data
          const businessType = cachedData.businessType as string;
          const model = (cachedData.modelJson ?? null) as ModelProposal | null;
          const selected = (cachedData.selectedKpiIds ?? []) as string[];
          const recommendedKpis = (cachedData.recommendedKpis ??
            []) as DatabaseKpi[];
          const additionalKpis = (cachedData.additionalKpis ??
            []) as DatabaseKpi[];

          // Process cached data same as fresh data
          let templates: LocalKpiTemplate[] = [];
          if (recommendedKpis.length > 0 || additionalKpis.length > 0) {
            const allKpis = [...recommendedKpis, ...additionalKpis];
            templates = allKpis.map((kpi) => ({
              id: kpi.id,
              label: kpi.name,
              description: kpi.definition,
              category: "General",
              trendGoal: "increase" as const,
              formula: kpi.formula || undefined,
              priority: recommendedKpis.some((rk) => rk.id === kpi.id)
                ? ("high" as const)
                : ("low" as const),
            }));
          } else {
            templates = [];
          }

          const availability = evaluateKpiAvailability(
            businessType,
            model,
            templates
          );

          setAvailabilities(availability);
          setSelectedIds(selected.length ? selected : []);
          setState({
            status: "ready",
            businessType,
            model,
            selected,
            recommendedKpis,
            additionalKpis,
          });
          return;
        }
      } catch (e) {
        console.warn("[KpiSelectionStep] Failed to parse cache:", e);
        sessionStorage.removeItem(cacheKey);
      }
    }

    const load = async () => {
      try {
        const res = await fetch("/api/onboarding/kpi-preferences");
        if (!res.ok) {
          setState({
            status: "error",
            message: "Failed to load KPI preferences.",
          });
          return;
        }
        const data = await res.json();

        // Cache the response in sessionStorage
        try {
          sessionStorage.setItem(
            cacheKey,
            JSON.stringify({
              ...data,
              timestamp: Date.now(),
            })
          );
        } catch (e) {
          console.warn("[KpiSelectionStep] Failed to cache data:", e);
        }
        const businessType = data.businessType as string;
        const model = (data.modelJson ?? null) as ModelProposal | null;
        const selected = (data.selectedKpiIds ?? []) as string[];
        const recommendedKpis = (data.recommendedKpis ?? []) as DatabaseKpi[];
        const additionalKpis = (data.additionalKpis ?? []) as DatabaseKpi[];

        console.log("[KpiSelectionStep] Loaded KPIs:", {
          recommended: recommendedKpis.length,
          additional: additionalKpis.length,
          businessType,
        });

        // Use KPIs from database (recommended + additional) if available
        let templates: LocalKpiTemplate[] = [];
        if (recommendedKpis.length > 0 || additionalKpis.length > 0) {
          // Convert database KPIs to template format
          const allKpis = [...recommendedKpis, ...additionalKpis];
          templates = allKpis.map((kpi) => ({
            id: kpi.id, // Use database ID
            label: kpi.name,
            description: kpi.definition,
            category: "General",
            trendGoal: "increase" as const,
            formula: kpi.formula || undefined,
            priority: recommendedKpis.some((rk) => rk.id === kpi.id)
              ? ("high" as const)
              : ("low" as const),
          }));
        } else {
          // Fall back to templates (shouldn't happen in normal flow)
          templates = [];
        }

        const availability = evaluateKpiAvailability(
          businessType,
          model,
          templates
        );

        setAvailabilities(availability);
        setSelectedIds(selected.length ? selected : []);
        setState({
          status: "ready",
          businessType,
          model,
          selected,
          recommendedKpis,
          additionalKpis,
        });
      } catch (err) {
        console.error("[KpiSelectionStep] load error", err);
        setState({
          status: "error",
          message: "Unexpected error while loading preferences.",
        });
      }
    };

    void load();
  }, []);

  const toggleKpi = (id: string, status: KpiAvailability["status"]) => {
    if (status === "requiresData") {
      // Clear any previous validation error
      setValidationError(null);
    }
    setSelectedIds((prev) => {
      const newSelection = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      // Clear validation error when user makes a selection
      if (newSelection.length >= MIN_SELECTED) {
        setValidationError(null);
      }
      return newSelection;
    });
  };

  const handleContinue = async () => {
    if (state.status !== "ready") return;
    if (selectedIds.length < MIN_SELECTED) {
      setValidationError(
        `Please select at least ${MIN_SELECTED} KPIs to continue.`
      );
      // Scroll to bottom to show the error
      setTimeout(() => {
        window.scrollTo({
          top: document.documentElement.scrollHeight,
          behavior: "smooth",
        });
      }, 100);
      return;
    }

    setValidationError(null);

    try {
      setIsSaving(true);
      const res = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedKpiIds: selectedIds }),
      });

      if (!res.ok) {
        setValidationError("Failed to save KPI preferences. Please try again.");
        return;
      }

      // Update onboarding status if we're in onboarding flow
      if (redirectTo.includes("/onboarding")) {
        const { updateOnboardingStatus } =
          await import("@/lib/onboarding-status");
        if (redirectTo.includes("/data-sources")) {
          await updateOnboardingStatus("data_sources");
        } else {
          await updateOnboardingStatus("upload");
        }
      } else if (redirectTo === "/dashboard") {
        // Mark onboarding as complete when going to dashboard
        const { markOnboardingComplete } =
          await import("@/lib/onboarding-status");
        await markOnboardingComplete();
      }

      // Move to the next step
      router.push(redirectTo);
    } catch (err) {
      console.error("[KpiSelectionStep] save error", err);
      setValidationError(
        "Unexpected error while saving KPI preferences. Please try again."
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (state.status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          Analyzing your data model to prepare tailored KPIs…
        </p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-500">{state.message}</p>
        <Button variant="outline" onClick={() => router.refresh()}>
          Retry
        </Button>
      </div>
    );
  }

  const { businessType } = state;
  const recommendedKpis = state.recommendedKpis ?? [];
  const additionalKpis = state.additionalKpis ?? [];

  // Use KPIs from database (recommended + additional) if available
  let recommendedTemplates: LocalKpiTemplate[] = [];
  let additionalTemplates: LocalKpiTemplate[] = [];

  if (recommendedKpis.length > 0) {
    recommendedTemplates = recommendedKpis.map((kpi) => ({
      id: kpi.id,
      label: kpi.name,
      description: kpi.definition,
      category: "General",
      trendGoal: "increase" as const,
      formula: kpi.formula || undefined,
      priority: "high" as const,
    }));
  }

  if (additionalKpis && additionalKpis.length > 0) {
    additionalTemplates = additionalKpis.map((kpi) => ({
      id: kpi.id,
      label: kpi.name,
      description: kpi.definition,
      category: "General",
      trendGoal: "increase" as const,
      formula: kpi.formula || undefined,
      priority: "low" as const,
    }));
  }

  // Combine all database KPIs - use these even if split failed
  const allDatabaseKpis = [...recommendedKpis, ...additionalKpis];
  const allDatabaseTemplates = [
    ...recommendedTemplates,
    ...additionalTemplates,
  ] as LocalKpiTemplate[];

  // Fallback to templates if no database KPIs (shouldn't happen in normal flow)
  const fallbackTemplates =
    allDatabaseTemplates.length > 0 ? allDatabaseTemplates : [];

  const availabilityById = new Map<string, KpiAvailability>();
  availabilities.forEach((a) => availabilityById.set(a.id, a));

  const renderKpiCard = (tpl: LocalKpiTemplate) => {
    const availability = availabilityById.get(tpl.id);
    const status = availability?.status ?? "available";
    const isSelected = selectedIds.includes(tpl.id);

    return (
      <Card
        key={tpl.id}
        className={cn(
          "cursor-pointer transition-colors border",
          isSelected
            ? "border-primary bg-primary/5"
            : "hover:border-primary/60",
          status === "requiresData" ? "opacity-80" : ""
        )}
        onClick={() => toggleKpi(tpl.id, status)}
      >
        <CardHeader className="space-y-1">
          <CardTitle className="text-sm font-semibold">{tpl.label}</CardTitle>
          <p className="text-xs text-muted-foreground">{tpl.description}</p>
        </CardHeader>
        <CardContent className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {tpl.trendGoal === "increase"
              ? "Higher is better"
              : tpl.trendGoal === "decrease"
                ? "Lower is better"
                : "Keep stable"}
          </span>
          <span
            className={cn(
              status === "requiresData" ? "text-yellow-600" : "text-green-600"
            )}
          >
            {status === "available" ? "Available" : "Needs more data"}
          </span>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Choose your key KPIs</h1>
        <p className="text-sm text-muted-foreground">
          Based on your business type and the data you connected, Milton
          recommends the following KPIs. Select at least {MIN_SELECTED} you care
          most about.
        </p>
      </div>

      {/* Show KPIs - prefer split view, but show all if split failed */}
      {allDatabaseTemplates.length > 0 ? (
        <>
          {/* Recommended KPIs Section */}
          {recommendedTemplates.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Recommended for You</h2>
                <p className="text-sm text-muted-foreground">
                  These KPIs are most relevant to your business goals.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {recommendedTemplates.map(renderKpiCard)}
              </div>
            </div>
          )}

          {/* Additional KPIs Section */}
          {additionalTemplates.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Additional KPIs</h2>
                <p className="text-sm text-muted-foreground">
                  Other KPIs you might find useful.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {additionalTemplates.map(renderKpiCard)}
              </div>
            </div>
          )}

          {/* If we have database KPIs but split failed, show all together */}
          {recommendedTemplates.length === 0 &&
            additionalTemplates.length === 0 &&
            allDatabaseTemplates.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold">Recommended KPIs</h2>
                  <p className="text-sm text-muted-foreground">
                    Based on your business type and the data you connected.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {allDatabaseTemplates.map(renderKpiCard)}
                </div>
              </div>
            )}
        </>
      ) : fallbackTemplates.length > 0 ? (
        /* Fallback: Show all KPIs from suggestions or templates */
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {fallbackTemplates.map(renderKpiCard)}
        </div>
      ) : (
        /* No KPIs available */
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No KPIs available for your business type. Please try again later.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <p className="text-xs text-muted-foreground">
            You can adjust your KPIs later in your dashboard settings.
          </p>
          <Button onClick={handleContinue} disabled={isSaving}>
            {isSaving
              ? "Saving…"
              : redirectTo.includes("/onboarding")
                ? "Continue"
                : "Continue to dashboard"}
          </Button>
        </div>
        {validationError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3">
            <p className="text-sm text-destructive font-medium">
              {validationError}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Selected: {selectedIds.length} / {MIN_SELECTED} required
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
