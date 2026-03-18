"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Paintbrush,
  GripVertical,
  ChevronUp,
  ChevronDown,
  RotateCcw,
  Sliders,
} from "lucide-react";
import type { DatabaseKpi } from "@/lib/types/kpi";
import type { KpiDisplayMode } from "@/components/dashboard/kpi-selector";
import {
  useDashboardTheme,
  THEME_PRESETS,
  THEME_DEFAULTS,
  DashboardTheme,
} from "@/lib/hooks/useDashboardTheme";

interface DashboardCustomizeModalProps {
  selectedKpis: DatabaseKpi[];
  kpiDisplayModes: Record<string, KpiDisplayMode>;
  onOrderSaved: (orderedKpis: DatabaseKpi[]) => void;
}

type Tab = "theme" | "widgets";

export function DashboardCustomizeModal({
  selectedKpis,
  kpiDisplayModes,
  onOrderSaved,
}: DashboardCustomizeModalProps) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("theme");

  // ── Theme ────────────────────────────────────────────────────────────────
  const { theme, setTheme, resetTheme } = useDashboardTheme();
  const [localTheme, setLocalTheme] = useState<DashboardTheme>(theme);

  const handleOpenChange = (v: boolean) => {
    if (v) {
      // Sync local theme to current persisted theme when opening
      setLocalTheme(theme);
      setLocalOrder(selectedKpis.map((k) => k.id));
    }
    setOpen(v);
  };

  const applyColor = (key: keyof DashboardTheme, value: string) => {
    const next = { ...localTheme, [key]: value };
    setLocalTheme(next);
    setTheme(next); // live preview
  };

  const applyPreset = (preset: (typeof THEME_PRESETS)[number]) => {
    const next = {
      primaryColor: preset.primaryColor,
      accentColor: preset.accentColor,
    };
    setLocalTheme(next);
    setTheme(next);
  };

  const handleReset = () => {
    resetTheme();
    setLocalTheme(THEME_DEFAULTS);
  };

  // ── Widget order ─────────────────────────────────────────────────────────
  const [localOrder, setLocalOrder] = useState<string[]>(
    selectedKpis.map((k) => k.id)
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const moveUp = useCallback((index: number) => {
    if (index === 0) return;
    setLocalOrder((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveDown = useCallback((index: number) => {
    setLocalOrder((prev) => {
      if (index === prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleSaveOrder = async () => {
    setSaving(true);
    setSaveError(null);

    // Build the selections array in the new order, preserving display modes
    const orderedSelections = localOrder.map((id) => ({
      id,
      displayTypes: kpiDisplayModes[id] ?? ["card"],
    }));

    try {
      const res = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ selectedKpiIds: orderedSelections }),
      });

      if (!res.ok) throw new Error("Failed to save");

      // Rebuild the ordered KPIs list and notify parent
      const kpiMap = new Map(selectedKpis.map((k) => [k.id, k]));
      const ordered = localOrder
        .map((id) => kpiMap.get(id))
        .filter((k): k is DatabaseKpi => k !== undefined);
      onOrderSaved(ordered);
      setOpen(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Derive ordered KPIs list for the UI
  const kpiMap = new Map(selectedKpis.map((k) => [k.id, k]));
  const orderedKpis = localOrder
    .map((id) => kpiMap.get(id))
    .filter((k): k is DatabaseKpi => k !== undefined);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Sliders className="h-4 w-4" />
          Customize
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Customize Dashboard</DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex border-b mb-4">
          {(["theme", "widgets"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "theme" ? "Colors" : "Widget Order"}
            </button>
          ))}
        </div>

        {/* ── Theme tab ── */}
        {activeTab === "theme" && (
          <div className="space-y-5">
            {/* Presets */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Presets</p>
              <div className="flex flex-wrap gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs hover:bg-muted transition-colors"
                    title={preset.label}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white shadow-sm"
                      style={{ background: preset.primaryColor }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-white shadow-sm"
                      style={{ background: preset.accentColor }}
                    />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom color pickers */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Paintbrush className="h-3.5 w-3.5" />
                  Primary color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={localTheme.primaryColor}
                    onChange={(e) => applyColor("primaryColor", e.target.value)}
                    className="h-9 w-9 rounded border cursor-pointer p-0.5 bg-background"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {localTheme.primaryColor}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Buttons, active states, chart lines
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Paintbrush className="h-3.5 w-3.5" />
                  Accent color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={localTheme.accentColor}
                    onChange={(e) => applyColor("accentColor", e.target.value)}
                    className="h-9 w-9 rounded border cursor-pointer p-0.5 bg-background"
                  />
                  <span className="text-xs text-muted-foreground font-mono">
                    {localTheme.accentColor}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Highlights, hover states
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-muted-foreground">
                Colors saved locally on this device.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="gap-1.5 text-xs"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to default
              </Button>
            </div>
          </div>
        )}

        {/* ── Widget order tab ── */}
        {activeTab === "widgets" && (
          <div className="space-y-4">
            {orderedKpis.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                No KPIs selected. Use &ldquo;Select KPIs&rdquo; to add widgets.
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Drag or use the arrows to reorder how KPIs appear on your
                  dashboard.
                </p>
                <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                  {orderedKpis.map((kpi, index) => {
                    const modes = kpiDisplayModes[kpi.id] ?? ["card"];
                    return (
                      <div
                        key={kpi.id}
                        className="flex items-center gap-2 p-2.5 rounded-lg border bg-card"
                      >
                        <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {kpi.name}
                          </p>
                          <div className="flex gap-1 mt-0.5">
                            {modes.map((m) => (
                              <span
                                key={m}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                              >
                                {m}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            onClick={() => moveUp(index)}
                            disabled={index === 0}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label="Move up"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => moveDown(index)}
                            disabled={index === orderedKpis.length - 1}
                            className="p-0.5 rounded hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            aria-label="Move down"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {saveError && (
                  <p className="text-sm text-destructive">{saveError}</p>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveOrder} disabled={saving}>
                    {saving ? "Saving…" : "Save Order"}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
