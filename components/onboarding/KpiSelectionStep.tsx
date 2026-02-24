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
import { Checkbox } from "@/components/ui/checkbox";
import { LayoutDashboard, TrendingUp, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { KpiDisplayMode } from "@/components/dashboard/kpi-selector";

type ApiState =
  | { status: "loading" }
  | {
      status: "ready";
      businessType: string;
      model: ModelProposal | null;
      selected: string[];
      kpiDisplayModes?: Record<string, KpiDisplayMode>;
      recommendedKpis?: DatabaseKpi[];
      additionalKpis?: DatabaseKpi[];
    }
  | { status: "error"; message: string };

const MIN_CARDS = 4;
const MIN_CHARTS = 2;
const MAX_CARDS = 8;
const MAX_CHARTS = 4;

const DISPLAY_MODE_OPTIONS: {
  value: "card" | "chart";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "card", label: "Card", icon: LayoutDashboard },
  { value: "chart", label: "Chart", icon: TrendingUp },
];

interface KpiSelectionStepProps {
  redirectTo?: string;
}

export function KpiSelectionStep({
  redirectTo = "/dashboard",
}: KpiSelectionStepProps) {
  const router = useRouter();
  const [state, setState] = useState<ApiState>({ status: "loading" });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [kpiDisplayModes, setKpiDisplayModes] = useState<
    Record<string, KpiDisplayMode>
  >({});
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
          const displayModes = (cachedData.kpiDisplayModes ?? {}) as Record<
            string,
            KpiDisplayMode
          >;
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
          setKpiDisplayModes(displayModes);
          setState({
            status: "ready",
            businessType,
            model,
            selected,
            kpiDisplayModes: displayModes,
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
        const displayModes = (data.kpiDisplayModes ?? {}) as Record<
          string,
          KpiDisplayMode
        >;
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
        setKpiDisplayModes(displayModes);
        setState({
          status: "ready",
          businessType,
          model,
          selected,
          kpiDisplayModes: displayModes,
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

      // Handle display modes
      if (prev.includes(id)) {
        // Unselecting: clear display modes
        setKpiDisplayModes((modes) => {
          const newModes = { ...modes };
          delete newModes[id];
          return newModes;
        });
      } else {
        // Selecting: set default display mode
        setKpiDisplayModes((modes) => ({
          ...modes,
          [id]: ["card"],
        }));
      }

      return newSelection;
    });
  };

  const updateKpiDisplayModes = (newModes: Record<string, KpiDisplayMode>) => {
    setKpiDisplayModes(newModes);
  };

  const getMissingTableNames = (kpi: DatabaseKpi): string[] => {
    // For onboarding, we'll assume all KPIs are available since data requirements
    // are checked at the data-sources step. Return empty array to indicate all available.
    return [];
  };

  const handleSetDisplayMode = (
    kpiId: string,
    mode: "card" | "chart",
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setKpiDisplayModes((prev) => {
      const current = Array.isArray(prev[kpiId]) ? prev[kpiId] : [];
      const isSelected = current.includes(mode);

      if (isSelected) {
        // Deselecting: always allow, but ensure at least one mode is selected
        const next = current.filter((m) => m !== mode);
        return { ...prev, [kpiId]: next.length > 0 ? next : [mode] };
      } else {
        // Selecting: check current limits
        const currentCardCount = selectedIds.reduce((count, id) => {
          const modes = id === kpiId ? [...current, mode] : prev[id];
          return (
            count + (Array.isArray(modes) && modes.includes("card") ? 1 : 0)
          );
        }, 0);
        const currentChartCount = selectedIds.reduce((count, id) => {
          const modes = id === kpiId ? [...current, mode] : prev[id];
          return (
            count + (Array.isArray(modes) && modes.includes("chart") ? 1 : 0)
          );
        }, 0);

        if (mode === "card" && currentCardCount > MAX_CARDS) return prev;
        if (mode === "chart" && currentChartCount > MAX_CHARTS) return prev;

        const next = [...current, mode];
        return { ...prev, [kpiId]: next };
      }
    });
  };

  const handleContinue = async () => {
    if (state.status !== "ready") return;

    // Calculate current counts
    const cardCount = selectedIds.reduce((count, kpiId) => {
      const modes = kpiDisplayModes[kpiId];
      return count + (Array.isArray(modes) && modes.includes("card") ? 1 : 0);
    }, 0);
    const chartCount = selectedIds.reduce((count, kpiId) => {
      const modes = kpiDisplayModes[kpiId];
      return count + (Array.isArray(modes) && modes.includes("chart") ? 1 : 0);
    }, 0);

    if (cardCount < MIN_CARDS || chartCount < MIN_CHARTS) {
      setValidationError(
        `Please select at least ${MIN_CARDS} cards and ${MIN_CHARTS} charts to continue.`
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
      // Combine selected KPIs with their display modes
      const selectedKpisWithDisplayTypes = selectedIds.map((id) => ({
        id,
        displayTypes: kpiDisplayModes[id] || ["card"], // Default to ['card'] if not set
      }));

      const res = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedKpiIds: selectedKpisWithDisplayTypes,
        }),
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

  // Calculate current counts for validation and display
  const cardCount = selectedIds.reduce((count, kpiId) => {
    const modes = kpiDisplayModes[kpiId];
    return count + (Array.isArray(modes) && modes.includes("card") ? 1 : 0);
  }, 0);
  const chartCount = selectedIds.reduce((count, kpiId) => {
    const modes = kpiDisplayModes[kpiId];
    return count + (Array.isArray(modes) && modes.includes("chart") ? 1 : 0);
  }, 0);

  const renderKpiCard = (kpi: DatabaseKpi, isRecommended: boolean) => {
    const isSelected = selectedIds.includes(kpi.id);
    const currentModes =
      Array.isArray(kpiDisplayModes[kpi.id]) &&
      kpiDisplayModes[kpi.id].length > 0
        ? kpiDisplayModes[kpi.id]
        : ["card"];
    const missingTableNames = getMissingTableNames(kpi);
    // Truly locked = missing data AND not selected (can't select without data)
    const isLocked = missingTableNames.length > 0 && !isSelected;

    return (
      <Card
        key={kpi.id}
        className={cn(
          "transition-all",
          isLocked
            ? "opacity-75 cursor-not-allowed border-border/50 bg-muted/30 hover:bg-muted/40"
            : isSelected
              ? "cursor-pointer border-primary bg-muted/50"
              : "cursor-pointer border-border hover:border-primary/50"
        )}
        onClick={() => !isLocked && toggleKpi(kpi.id, "available")}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <CardTitle
                className={cn("text-sm", isLocked && "text-foreground/80")}
              >
                {kpi.name}
              </CardTitle>
              {isRecommended && !isLocked && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                  Recommended
                </span>
              )}
            </div>
            <Checkbox
              checked={isSelected}
              disabled={isLocked}
              onCheckedChange={() =>
                !isLocked && toggleKpi(kpi.id, "available")
              }
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p
            className={cn(
              "text-xs text-muted-foreground",
              isLocked && "text-muted-foreground/80"
            )}
          >
            {kpi.definition}
          </p>
          {kpi.formula && !isLocked && (
            <p className="text-[11px] text-muted-foreground font-mono">
              {kpi.formula}
            </p>
          )}

          {/* Missing data warning */}
          {missingTableNames.length > 0 && (
            <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
              <div className="space-y-0.5">
                <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                  Data not available
                </p>
                <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80">
                  Upload required: {missingTableNames.join(", ")}
                </p>
              </div>
            </div>
          )}

          {/* Display mode toggles (only for selected KPIs with data available) */}
          {isSelected && missingTableNames.length === 0 && (
            <div
              className="flex gap-1.5 pt-2"
              onClick={(e) => e.stopPropagation()}
            >
              {DISPLAY_MODE_OPTIONS.map(({ value, label, icon: Icon }) => {
                const isModeSelected = currentModes.includes(value);
                const isAtLimit =
                  (value === "card" &&
                    selectedIds.reduce((count, id) => {
                      const modes = kpiDisplayModes[id];
                      return (
                        count +
                        (Array.isArray(modes) && modes.includes("card") ? 1 : 0)
                      );
                    }, 0) >= MAX_CARDS &&
                    !isModeSelected) ||
                  (value === "chart" &&
                    selectedIds.reduce((count, id) => {
                      const modes = kpiDisplayModes[id];
                      return (
                        count +
                        (Array.isArray(modes) && modes.includes("chart")
                          ? 1
                          : 0)
                      );
                    }, 0) >= MAX_CHARTS &&
                    !isModeSelected);
                return (
                  <button
                    key={value}
                    onClick={(e) => handleSetDisplayMode(kpi.id, value, e)}
                    disabled={isAtLimit}
                    className={cn(
                      "relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200",
                      "border shadow-sm",
                      isModeSelected
                        ? "bg-primary text-primary-foreground border-primary shadow-md ring-2 ring-primary/20"
                        : isAtLimit
                          ? "bg-muted text-muted-foreground/50 border-muted cursor-not-allowed opacity-50"
                          : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground hover:bg-accent/50 hover:shadow-md"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5",
                        isModeSelected
                          ? "text-primary-foreground"
                          : "text-muted-foreground"
                      )}
                    />
                    {label}
                    {isModeSelected && (
                      <div className="absolute inset-0 rounded-md bg-primary/5 ring-1 ring-primary/10" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
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
          recommends the following KPIs. Select at least {MIN_CARDS} cards and{" "}
          {MIN_CHARTS} charts to display on your dashboard.
        </p>
      </div>

      {/* Show KPIs */}
      {allDatabaseKpis.length > 0 ? (
        <>
          {/* Recommended KPIs Section */}
          {recommendedKpis.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Recommended for You</h2>
                <p className="text-sm text-muted-foreground">
                  These KPIs are most relevant to your business goals.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {recommendedKpis.map((kpi) => renderKpiCard(kpi, true))}
              </div>
            </div>
          )}

          {/* Additional KPIs Section */}
          {additionalKpis.length > 0 && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">Additional KPIs</h2>
                <p className="text-sm text-muted-foreground">
                  Other KPIs you might find useful.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {additionalKpis.map((kpi) => renderKpiCard(kpi, false))}
              </div>
            </div>
          )}

          {/* If we have database KPIs but split failed, show all together */}
          {recommendedKpis.length === 0 &&
            additionalKpis.length === 0 &&
            allDatabaseKpis.length > 0 && (
              <div className="space-y-3">
                <div>
                  <h2 className="text-lg font-semibold">Recommended KPIs</h2>
                  <p className="text-sm text-muted-foreground">
                    Based on your business type and the data you connected.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {allDatabaseKpis.map((kpi) => renderKpiCard(kpi, false))}
                </div>
              </div>
            )}
        </>
      ) : (
        /* No KPIs available */
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No KPIs available for your business type. Please try again later.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {/* Selection Summary */}
        <div className="flex gap-4 text-sm">
          <span
            className={selectedIds.length === 0 ? "text-muted-foreground" : ""}
          >
            {selectedIds.length} KPI{selectedIds.length !== 1 ? "s" : ""}{" "}
            selected
          </span>
          <span
            className={
              cardCount >= MIN_CARDS
                ? "text-muted-foreground"
                : "text-destructive"
            }
          >
            Cards: {cardCount}/{MIN_CARDS}
          </span>
          <span
            className={
              chartCount >= MIN_CHARTS
                ? "text-muted-foreground"
                : "text-destructive"
            }
          >
            Charts: {chartCount}/{MIN_CHARTS}
          </span>
        </div>

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
          </div>
        )}
      </div>
    </div>
  );
}
