"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CompareScenario {
  id: string;
  name: string;
  locked?: boolean;
  color?: string;
}

interface ScenarioSelectorProps {
  scenarios: CompareScenario[];
  selectedScenarios: string[];
  onSelectionChange: (selected: string[]) => void;
}

export function ScenarioSelector({
  scenarios,
  selectedScenarios,
  onSelectionChange,
}: ScenarioSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleScenario = (scenarioId: string) => {
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (scenario?.locked) return;

    if (selectedScenarios.includes(scenarioId)) {
      onSelectionChange(selectedScenarios.filter((id) => id !== scenarioId));
    } else {
      onSelectionChange([...selectedScenarios, scenarioId]);
    }
  };

  const removeScenario = (scenarioId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const scenario = scenarios.find((s) => s.id === scenarioId);
    if (scenario?.locked) return;
    onSelectionChange(selectedScenarios.filter((id) => id !== scenarioId));
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        type="button"
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className="min-w-[280px] justify-between gap-2 h-auto py-2"
      >
        <div className="flex-1 flex items-center gap-2 flex-wrap">
          {selectedScenarios.length === 0 ? (
            <span className="text-muted-foreground">Select scenarios…</span>
          ) : (
            selectedScenarios.map((id) => {
              const scenario = scenarios.find((s) => s.id === id);
              if (!scenario) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/10 text-primary rounded text-sm"
                >
                  {scenario.name}
                  {scenario.locked && (
                    <span className="text-xs opacity-60">(locked)</span>
                  )}
                  {!scenario.locked && (
                    <X
                      size={14}
                      className="cursor-pointer hover:opacity-80 shrink-0"
                      onClick={(e) => removeScenario(id, e)}
                    />
                  )}
                </span>
              );
            })
          )}
        </div>
        <ChevronDown
          size={16}
          className={cn(
            "text-muted-foreground shrink-0 transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </Button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-full min-w-[280px] bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden">
          {scenarios.map((scenario) => (
            <label
              key={scenario.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 hover:bg-accent cursor-pointer",
                scenario.locked && "opacity-60 cursor-not-allowed"
              )}
            >
              <input
                type="checkbox"
                checked={selectedScenarios.includes(scenario.id)}
                onChange={() => toggleScenario(scenario.id)}
                disabled={scenario.locked}
                className="rounded border-input text-primary focus:ring-primary"
              />
              <span className="flex-1 text-sm font-medium">
                {scenario.name}
              </span>
              {scenario.locked && (
                <span className="text-xs text-muted-foreground">Locked</span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
