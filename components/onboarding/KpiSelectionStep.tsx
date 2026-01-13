"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KPI_TEMPLATES, type KpiTemplate } from "@/lib/kpi-templates";
import {
  evaluateKpiAvailability,
  type KpiAvailability,
} from "@/lib/kpi-availability";
import type {
  ModelProposal,
  SuggestedKPI,
} from "@/lib/ai/business-model-analyzer-types";
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
      suggestedKpis?: SuggestedKPI[];
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

  useEffect(() => {
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
        const businessType = data.businessType as string;
        const model = (data.modelJson ?? null) as ModelProposal | null;
        const selected = (data.selectedKpiIds ?? []) as string[];
        const suggestedKpis = (data.suggestedKpis ?? []) as SuggestedKPI[];

        // Use suggested KPIs if available, otherwise fall back to templates
        let templates: KpiTemplate[] = [];
        if (suggestedKpis.length > 0) {
          // Convert suggested KPIs to template format
          templates = suggestedKpis.map((kpi) => ({
            id: kpi.name.toLowerCase().replace(/\s+/g, "_"),
            label: kpi.name,
            description: kpi.description,
            category: kpi.category,
            trendGoal: "increase" as const,
            formula: kpi.formula,
            priority: kpi.priority,
          }));
        } else {
          // Fall back to templates
          templates = KPI_TEMPLATES[businessType] ?? [];
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
          suggestedKpis,
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
      // For now, allow selection but show a warning
      window.alert(
        "This KPI cannot be calculated with your current data. Consider uploading or modeling the required data first."
      );
    }
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleContinue = async () => {
    if (state.status !== "ready") return;
    if (selectedIds.length < MIN_SELECTED) {
      window.alert(`Please select at least ${MIN_SELECTED} KPIs.`);
      return;
    }

    try {
      setIsSaving(true);
      const res = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedKpiIds: selectedIds }),
      });

      if (!res.ok) {
        window.alert("Failed to save KPI preferences. Please try again.");
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
      window.alert("Unexpected error while saving KPI preferences.");
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

  const { businessType, suggestedKpis } = state;

  // Use suggested KPIs if available, otherwise fall back to templates
  let templates: KpiTemplate[] = [];
  if (suggestedKpis && suggestedKpis.length > 0) {
    // Convert suggested KPIs to template format (already done in useEffect, but ensure we use them)
    templates = suggestedKpis.map((kpi) => ({
      id: kpi.name.toLowerCase().replace(/\s+/g, "_"),
      label: kpi.name,
      description: kpi.description,
      category: kpi.category,
      trendGoal: "increase" as const,
      formula: kpi.formula,
      priority: kpi.priority,
    }));
  } else {
    // Fall back to templates
    templates = KPI_TEMPLATES[businessType] ?? [];
  }

  const availabilityById = new Map<string, KpiAvailability>();
  availabilities.forEach((a) => availabilityById.set(a.id, a));

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

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((tpl) => {
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
                <CardTitle className="text-sm font-semibold">
                  {tpl.label}
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {tpl.description}
                </p>
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
                    status === "requiresData"
                      ? "text-yellow-600"
                      : "text-green-600"
                  )}
                >
                  {status === "available" ? "Available" : "Needs more data"}
                </span>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="flex justify-between items-center">
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
    </div>
  );
}
