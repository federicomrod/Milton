"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Settings2,
  LayoutDashboard,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { DatabaseKpi } from "@/lib/types/kpi";
import { cn } from "@/lib/utils";

export type KpiDisplayMode = ("card" | "chart")[];

interface KpiSelectorProps {
  selectedKpiIds: string[];
  onKpisChange: (kpiIds: string[]) => void;
  recommendedKpis?: DatabaseKpi[];
  additionalKpis?: DatabaseKpi[];
  kpiDisplayModes?: Record<string, KpiDisplayMode>;
  onDisplayModesChange?: (modes: Record<string, KpiDisplayMode>) => void;
  disabled?: boolean;
}

const DISPLAY_MODE_OPTIONS: {
  value: "card" | "chart";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: "card", label: "Card", icon: LayoutDashboard },
  { value: "chart", label: "Chart", icon: TrendingUp },
];

export function KpiSelector({
  selectedKpiIds,
  onKpisChange,
  recommendedKpis = [],
  additionalKpis = [],
  kpiDisplayModes = {},
  onDisplayModesChange,
  disabled = false,
}: KpiSelectorProps) {
  console.log("[KpiSelector] Props:", {
    selectedKpiIds: selectedKpiIds?.length,
    recommendedKpis: recommendedKpis?.length,
    additionalKpis: additionalKpis?.length,
    disabled,
  });

  const [open, setOpen] = useState(false);
  const [tempSelection, setTempSelection] = useState<string[]>(selectedKpiIds);
  const [tempDisplayModes, setTempDisplayModes] =
    useState<Record<string, KpiDisplayMode>>(kpiDisplayModes);
  const [availableTableIds, setAvailableTableIds] = useState<Set<string>>(
    new Set()
  );
  const [tableNames, setTableNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setTempSelection(selectedKpiIds);
    setTempDisplayModes(kpiDisplayModes);
  }, [selectedKpiIds, kpiDisplayModes]);

  // Fetch table status data and names when dialog opens
  useEffect(() => {
    if (!open) return;

    setLoading(true);

    // Fetch available tables with data
    fetch("/api/data/status", {
      cache: "no-store",
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : { tablesWithData: [] }))
      .then(
        (json: {
          tablesWithData?: Array<{
            id: string;
            name: string;
            recordCount: number;
          }>;
        }) => {
          const tables = json.tablesWithData ?? [];
          setAvailableTableIds(new Set(tables.map((t) => t.id)));
          // Start with names from tables that have data
          const initialNames = Object.fromEntries(
            tables.map((t) => [t.id, t.name])
          );
          setTableNames(initialNames);

          // Also fetch names for ALL possible required tables from any KPI
          // This ensures we have names even for tables required by KPIs not currently displayed
          fetch("/api/data/table-names?ids=all", {
            cache: "no-store",
            credentials: "include",
          })
            .then((r) => (r.ok ? r.json() : { names: {} }))
            .then((json: { names?: Record<string, string> }) => {
              const names = json.names ?? {};
              setTableNames((prev) => ({ ...prev, ...names }));
              // Only set loading to false when both API calls are complete
              setLoading(false);
            })
            .catch(() => {
              setLoading(false);
            });
        }
      )
      .catch(() => {
        setLoading(false);
      });
  }, [open]);

  const getMissingTableNames = (kpi: DatabaseKpi): string[] => {
    const required = kpi.required_data ?? [];
    return required
      .filter((id) => !availableTableIds.has(id))
      .map((id) => tableNames[id] || `Table ${id}`);
  };

  const handleToggleKpi = (kpi: DatabaseKpi) => {
    const missing = getMissingTableNames(kpi);
    const isSelected = tempSelection.includes(kpi.id);
    // Allow deselecting even when data is missing, but block selecting
    if (missing.length > 0 && !isSelected) return;

    setTempSelection((prev) => {
      const wasSelected = prev.includes(kpi.id);
      const next = wasSelected
        ? prev.filter((id) => id !== kpi.id)
        : [...prev, kpi.id];

      if (wasSelected) {
        // Unselecting: clear display modes
        setTempDisplayModes((modes) => {
          const newModes = { ...modes };
          delete newModes[kpi.id];
          return newModes;
        });
      } else {
        // Selecting: set default display mode
        setTempDisplayModes((modes) => {
          const currentModes = Array.isArray(modes[kpi.id])
            ? modes[kpi.id]
            : [];
          return {
            ...modes,
            [kpi.id]: currentModes.length > 0 ? currentModes : ["card"],
          };
        });
      }
      return next;
    });
  };

  const handleSetDisplayMode = (
    kpiId: string,
    mode: "card" | "chart",
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    setTempDisplayModes((prev) => {
      const current = Array.isArray(prev[kpiId]) ? prev[kpiId] : [];
      const isSelected = current.includes(mode);

      if (isSelected) {
        // Deselecting: always allow, but ensure at least one mode is selected
        const next = current.filter((m) => m !== mode);
        return { ...prev, [kpiId]: next.length > 0 ? next : [mode] };
      } else {
        // Selecting: check current limits
        const currentCardCount = tempSelection.reduce((count, id) => {
          const modes = id === kpiId ? [...current, mode] : prev[id];
          return (
            count + (Array.isArray(modes) && modes.includes("card") ? 1 : 0)
          );
        }, 0);
        const currentChartCount = tempSelection.reduce((count, id) => {
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

  const handleSave = async () => {
    if (hasExceededLimits) return;

    setSaving(true);
    setSaveError(null);

    try {
      // Save KPI selection and display modes to the database
      const selections = tempSelection.map((kpiId) => ({
        id: kpiId,
        displayTypes: tempDisplayModes[kpiId] || ["card"],
      }));

      const response = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ selectedKpiIds: selections }),
      });

      if (!response.ok) {
        throw new Error("Failed to save KPI preferences");
      }

      // Update parent component
      onKpisChange(tempSelection);
      onDisplayModesChange?.(tempDisplayModes);
      setOpen(false);
    } catch (err) {
      console.error("Error saving KPI preferences:", err);
      setSaveError(
        err instanceof Error ? err.message : "Failed to save KPI preferences"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTempSelection(selectedKpiIds);
    setTempDisplayModes(kpiDisplayModes);
    setOpen(false);
  };

  const allKpis = [...recommendedKpis, ...additionalKpis];

  // Calculate current counts for limits (only for selected KPIs)
  const cardCount = tempSelection.reduce((count, kpiId) => {
    const modes = tempDisplayModes[kpiId];
    return count + (Array.isArray(modes) && modes.includes("card") ? 1 : 0);
  }, 0);
  const chartCount = tempSelection.reduce((count, kpiId) => {
    const modes = tempDisplayModes[kpiId];
    return count + (Array.isArray(modes) && modes.includes("chart") ? 1 : 0);
  }, 0);

  const MAX_CARDS = 8;
  const MAX_CHARTS = 4;

  // Check if current selection exceeds limits
  const hasExceededLimits = cardCount > MAX_CARDS || chartCount > MAX_CHARTS;

  const renderKpiCard = (kpi: DatabaseKpi, isRecommended: boolean) => {
    const isSelected = tempSelection.includes(kpi.id);
    const currentModes =
      Array.isArray(tempDisplayModes[kpi.id]) &&
      tempDisplayModes[kpi.id].length > 0
        ? tempDisplayModes[kpi.id]
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
        onClick={() => !isLocked && handleToggleKpi(kpi)}
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
              onCheckedChange={() => !isLocked && handleToggleKpi(kpi)}
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
                    cardCount >= MAX_CARDS &&
                    !isModeSelected) ||
                  (value === "chart" &&
                    chartCount >= MAX_CHARTS &&
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={disabled}
        >
          <Settings2 className="h-4 w-4" />
          Select KPIs
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-w-5xl max-h-[85vh] overflow-y-auto"
        style={{
          maxWidth: "75vw",
          maxHeight: "85vh",
          width: "75vw",
        }}
        suppressHydrationWarning
      >
        <DialogHeader>
          <DialogTitle>Select Your KPIs</DialogTitle>
          <DialogDescription>
            Choose which KPIs to track and how to display them — as a summary
            card, a trend chart, or both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                Loading KPI data...
              </div>
            </div>
          ) : (
            <>
              {/* Recommended KPIs Section */}
              {recommendedKpis.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium text-sm">Recommended for You</h4>
                    <p className="text-xs text-muted-foreground">
                      These KPIs are most relevant to your business goals
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {recommendedKpis.map((kpi) => renderKpiCard(kpi, true))}
                  </div>
                </div>
              )}

              {/* Additional KPIs Section */}
              {additionalKpis.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium text-sm">Additional KPIs</h4>
                    <p className="text-xs text-muted-foreground">
                      Other KPIs you might find useful
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {additionalKpis.map((kpi) => renderKpiCard(kpi, false))}
                  </div>
                </div>
              )}

              {/* Currently Selected KPIs (when no definitions available) */}
              {recommendedKpis.length === 0 &&
                additionalKpis.length === 0 &&
                tempSelection.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-sm">
                        Currently Selected KPIs
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        These KPIs are selected but their definitions are not
                        currently available
                      </p>
                    </div>
                    <div className="space-y-2">
                      {tempSelection.map((kpiId) => (
                        <div
                          key={kpiId}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              KPI ID: {kpiId}
                            </span>
                            {tempDisplayModes[kpiId] &&
                              tempDisplayModes[kpiId].length > 0 && (
                                <div className="flex gap-1">
                                  {tempDisplayModes[kpiId].map((mode) => (
                                    <span
                                      key={mode}
                                      className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded"
                                    >
                                      {mode}
                                    </span>
                                  ))}
                                </div>
                              )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleToggleKpi({
                                id: kpiId,
                                name: `KPI ${kpiId}`,
                                definition: "Definition not available",
                              } as DatabaseKpi)
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* All Available KPIs (if no recommended/additional split) */}
              {recommendedKpis.length === 0 &&
                additionalKpis.length === 0 &&
                allKpis.length > 0 && (
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-sm">Available KPIs</h4>
                      <p className="text-xs text-muted-foreground">
                        Select the KPIs you want to track
                      </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {allKpis.map((kpi) => renderKpiCard(kpi, false))}
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-border">
          <div className="flex gap-4 text-sm">
            <span
              className={
                tempSelection.length === 0 ? "text-muted-foreground" : ""
              }
            >
              {tempSelection.length} KPI{tempSelection.length !== 1 ? "s" : ""}{" "}
              selected
            </span>
            <span
              className={
                cardCount > MAX_CARDS
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              Cards: {cardCount}/{MAX_CARDS}
            </span>
            <span
              className={
                chartCount > MAX_CHARTS
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              Charts: {chartCount}/{MAX_CHARTS}
            </span>
            {hasExceededLimits && (
              <span className="text-destructive text-xs">
                Please reduce selection to meet limits
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={hasExceededLimits || saving}>
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
          {saveError && (
            <div className="text-sm text-destructive mt-2">{saveError}</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
