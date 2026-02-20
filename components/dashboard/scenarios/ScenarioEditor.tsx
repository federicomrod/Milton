"use client";

import { useState, useMemo, useEffect } from "react";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DriverSection } from "@/components/dashboard/scenarios/DriverSection";
import { ImpactPreview } from "@/components/dashboard/scenarios/ImpactPreview";
import { RunningSimulationModal } from "@/components/dashboard/scenarios/RunningSimulationModal";
import {
  getDriverSectionsForBusinessModel,
  type DriverSection as DriverSectionType,
} from "@/lib/scenario-drivers";

export type ScenarioEditorStatus = "Draft" | "Projected" | "Ready";

interface ScenarioEditorProps {
  businessType: string | null;
  businessModelDisplayName: string;
  scenarioName: string;
  status: ScenarioEditorStatus;
  /** Pre-merged sections from API (template + driver_overrides); if not provided, template only */
  initialSections?: DriverSectionType[];
  /** Called when user clicks Save; persist name + driver_overrides */
  onSave?: (
    name: string,
    sections: DriverSectionType[]
  ) => void | Promise<void>;
  /** Called before opening run modal; use to persist driver_overrides and name */
  onSaveDriverOverrides?: (
    sections: DriverSectionType[],
    currentName?: string
  ) => void | Promise<void>;
  /** Called when simulation finishes successfully; e.g. navigate to results */
  onSimulationComplete?: () => void;
}

function getStatusVariant(
  status: ScenarioEditorStatus
): "default" | "secondary" | "outline" {
  switch (status) {
    case "Ready":
    case "Projected":
      return "default";
    case "Draft":
      return "secondary";
    default:
      return "outline";
  }
}

export function ScenarioEditor({
  businessType,
  businessModelDisplayName,
  scenarioName,
  status,
  initialSections: initialSectionsProp,
  onSave,
  onSaveDriverOverrides,
  onSimulationComplete,
}: ScenarioEditorProps) {
  const templateSections = useMemo(
    () => getDriverSectionsForBusinessModel(businessType),
    [businessType]
  );
  const initialSections = initialSectionsProp ?? templateSections;

  const [sections, setSections] =
    useState<DriverSectionType[]>(initialSections);
  const [name, setName] = useState(scenarioName);
  const [hasChanges, setHasChanges] = useState(false);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(scenarioName);
  }, [scenarioName]);

  const handleDriverChange = (
    sectionId: string,
    driverId: string,
    value: number
  ) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              drivers: section.drivers.map((driver) =>
                driver.id === driverId ? { ...driver, value } : driver
              ),
            }
          : section
      )
    );
    setHasChanges(true);
  };

  const handleResetDriver = (sectionId: string, driverId: string) => {
    setSections((prev) =>
      prev.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              drivers: section.drivers.map((driver) =>
                driver.id === driverId
                  ? { ...driver, value: driver.baseline }
                  : driver
              ),
            }
          : section
      )
    );
    setHasChanges(true);
  };

  const handleResetAll = () => {
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        drivers: section.drivers.map((driver) => ({
          ...driver,
          value: driver.baseline,
        })),
      }))
    );
    setHasChanges(false);
  };

  const handleSave = async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await Promise.resolve(onSave(name.trim() || scenarioName, sections));
      setHasChanges(false);
    } finally {
      setSaving(false);
    }
  };

  const handleRunSimulation = async () => {
    if (onSaveDriverOverrides) {
      setSaving(true);
      try {
        await Promise.resolve(
          onSaveDriverOverrides(sections, name.trim() || scenarioName)
        );
      } finally {
        setSaving(false);
      }
    }
    setSimulationOpen(true);
  };

  const handleSimulationComplete = () => {
    setHasChanges(false);
    onSimulationComplete?.();
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-xl font-semibold text-foreground min-w-0 max-w-full rounded-md border border-transparent bg-muted/40 px-2 py-1 -ml-2 placeholder:text-muted-foreground hover:border-border hover:bg-muted/60 focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Scenario name"
              aria-label="Scenario name"
            />
            <Badge variant={getStatusVariant(status)} className="shrink-0">
              {status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Info className="h-4 w-4 shrink-0" />
            <span>Business Model: {businessModelDisplayName}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <div className="h-full grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
          {/* Left - Drivers */}
          <Card className="p-6 overflow-y-auto flex flex-col gap-6 border">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-foreground">
                Scenario Drivers
              </h2>
              <p className="text-sm text-muted-foreground">
                Adjust the drivers to model different scenarios
              </p>
            </div>
            <Separator />
            <div className="space-y-4">
              {sections.map((section) => (
                <DriverSection
                  key={section.id}
                  section={section}
                  onDriverChange={handleDriverChange}
                  onResetDriver={handleResetDriver}
                />
              ))}
            </div>
          </Card>

          {/* Right - Impact Preview */}
          <div className="flex flex-col gap-6">
            <Card className="p-6 border flex flex-col gap-6">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-foreground">
                  Impact Preview
                </h2>
                <p className="text-sm text-muted-foreground">
                  Projected changes vs. baseline
                </p>
              </div>
              <Separator />
              <ImpactPreview hasChanges={hasChanges} />
            </Card>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <p className="text-sm text-foreground">
                  Projections update after running the simulation. Changes are
                  calculated based on your driver adjustments.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button variant="outline" onClick={handleResetAll}>
            Reset to Baseline
          </Button>
          <div className="flex items-center gap-2">
            {onSave && (
              <Button variant="outline" onClick={handleSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            )}
            <Button onClick={handleRunSimulation} disabled={saving}>
              {saving ? "Saving…" : "Run Simulation"}
            </Button>
          </div>
        </div>
      </div>

      <RunningSimulationModal
        open={simulationOpen}
        onOpenChange={setSimulationOpen}
        onComplete={handleSimulationComplete}
      />
    </div>
  );
}
