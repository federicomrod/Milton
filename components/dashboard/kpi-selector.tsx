"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings2 } from "lucide-react";
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

interface KpiSelectorProps {
  selectedKpiIds: string[];
  onKpisChange: (kpiIds: string[]) => void;
  recommendedKpis?: DatabaseKpi[];
  additionalKpis?: DatabaseKpi[];
}

export function KpiSelector({
  selectedKpiIds,
  onKpisChange,
  recommendedKpis = [],
  additionalKpis = [],
}: KpiSelectorProps) {
  const [open, setOpen] = useState(false);
  const [tempSelection, setTempSelection] = useState<string[]>(selectedKpiIds);

  useEffect(() => {
    setTempSelection(selectedKpiIds);
  }, [selectedKpiIds]);

  const handleToggleKpi = (kpiId: string) => {
    setTempSelection((prev) =>
      prev.includes(kpiId)
        ? prev.filter((id) => id !== kpiId)
        : [...prev, kpiId]
    );
  };

  const handleSave = async () => {
    try {
      const res = await fetch("/api/onboarding/kpi-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedKpiIds: tempSelection }),
      });

      if (!res.ok) {
        console.error("Failed to save KPI preferences");
        return;
      }

      onKpisChange(tempSelection);
      setOpen(false);
    } catch (err) {
      console.error("Error saving KPI preferences:", err);
    }
  };

  const handleCancel = () => {
    setTempSelection(selectedKpiIds);
    setOpen(false);
  };

  const allKpis = [...recommendedKpis, ...additionalKpis];

  const renderKpiCard = (kpi: DatabaseKpi, isRecommended: boolean) => {
    const isSelected = tempSelection.includes(kpi.id);
    return (
      <Card
        key={kpi.id}
        className={cn(
          "cursor-pointer transition-all",
          isSelected
            ? "border-primary bg-muted/50"
            : "border-border hover:border-primary/50"
        )}
        onClick={() => handleToggleKpi(kpi.id)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <CardTitle className="text-sm">{kpi.name}</CardTitle>
              {isRecommended && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/20 text-primary font-semibold">
                  Recommended
                </span>
              )}
            </div>
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => handleToggleKpi(kpi.id)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">{kpi.definition}</p>
          {kpi.formula && (
            <p className="text-[11px] text-muted-foreground mt-1 font-mono">
              {kpi.formula}
            </p>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings2 className="h-4 w-4" />
          Select KPIs
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select Your KPIs</DialogTitle>
          <DialogDescription>
            Choose which KPIs you want to track on your dashboard. Select at
            least 3 KPIs to continue.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-border">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              {tempSelection.length} KPI{tempSelection.length !== 1 ? "s" : ""}{" "}
              selected
            </p>
            {tempSelection.length < 3 && (
              <p className="text-xs text-destructive">
                Please select at least 3 KPIs
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={tempSelection.length < 3}>
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
