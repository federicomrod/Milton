"use client";

import { RotateCcw, Info } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DriverSection as DriverSectionType } from "@/lib/scenario-drivers";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface DriverSectionProps {
  section: DriverSectionType;
  onDriverChange: (sectionId: string, driverId: string, value: number) => void;
  onResetDriver: (sectionId: string, driverId: string) => void;
}

export function DriverSection({
  section,
  onDriverChange,
  onResetDriver,
}: DriverSectionProps) {
  const [open, setOpen] = useState(true);

  const handleSliderChange = (driverId: string, values: number[]) => {
    onDriverChange(section.id, driverId, values[0]);
  };

  const handleInputChange = (
    driverId: string,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = parseFloat(e.target.value);
    if (!isNaN(value)) {
      onDriverChange(section.id, driverId, value);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border px-4">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between py-3 text-left font-medium hover:no-underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
          >
            <span>{section.title}</span>
            {open ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-6 pt-2 pb-4">
            {section.drivers.map((driver) => (
              <div key={driver.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Label
                      htmlFor={`${section.id}-${driver.id}`}
                      className="text-sm font-medium"
                    >
                      {driver.label}
                    </Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help text-muted-foreground hover:text-foreground">
                          <Info className="h-4 w-4" />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-xs">
                        <p>{driver.description}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onResetDriver(section.id, driver.id)}
                    className="h-6 px-2 text-xs"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                </div>

                {driver.type === "slider" ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Slider
                        id={`${section.id}-${driver.id}`}
                        min={driver.min ?? 0}
                        max={driver.max ?? 100}
                        step={driver.step ?? 1}
                        value={[driver.value]}
                        onValueChange={(values) =>
                          handleSliderChange(driver.id, values)
                        }
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1 min-w-[80px]">
                        <Input
                          type="number"
                          value={driver.value}
                          onChange={(e) => handleInputChange(driver.id, e)}
                          className="h-8 w-16 text-right"
                          min={driver.min}
                          max={driver.max}
                          step={driver.step ?? 1}
                        />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {driver.unit}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      id={`${section.id}-${driver.id}`}
                      type="number"
                      value={driver.value}
                      onChange={(e) => handleInputChange(driver.id, e)}
                      className="h-9 max-w-[200px]"
                      min={driver.min}
                      max={driver.max}
                      step={driver.step ?? 1}
                    />
                    <span className="text-sm text-muted-foreground whitespace-nowrap">
                      {driver.unit}
                    </span>
                  </div>
                )}

                {driver.value !== driver.baseline && (
                  <p className="text-xs text-primary">
                    Changed from baseline: {driver.baseline} {driver.unit}
                  </p>
                )}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
