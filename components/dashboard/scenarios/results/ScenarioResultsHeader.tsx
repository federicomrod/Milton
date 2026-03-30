"use client";

import { Pencil, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface ScenarioResultsHeaderProps {
  scenarioName: string;
  status?: "Draft" | "Projected" | "Ready";
  description?: string;
  onEditAssumptions?: () => void;
  onDuplicate?: () => void;
  onCompareScenarios?: () => void;
}

export function ScenarioResultsHeader({
  scenarioName,
  status = "Projected",
  description = "Impact analysis vs baseline scenario",
  onEditAssumptions,
  onDuplicate,
  onCompareScenarios,
}: ScenarioResultsHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            {scenarioName}
          </h1>
          <Badge className="bg-primary/10 text-primary border-primary/30">
            {status}
          </Badge>
        </div>
        <p className="text-muted-foreground">{description}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {onEditAssumptions && (
          <Button
            variant="outline"
            size="sm"
            onClick={onEditAssumptions}
            className="gap-2"
          >
            <Pencil className="h-4 w-4" />
            Edit assumptions
          </Button>
        )}
        {onDuplicate && (
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicate}
            className="gap-2"
          >
            <Copy className="h-4 w-4" />
            Duplicate scenario
          </Button>
        )}
        {onCompareScenarios && (
          <Button size="sm" onClick={onCompareScenarios}>
            Compare Scenarios
          </Button>
        )}
      </div>
    </div>
  );
}
