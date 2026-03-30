"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  onCreateScenario: () => void;
}

export function EmptyState({ onCreateScenario }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
        <Plus className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No scenarios created yet
      </h3>
      <p className="text-muted-foreground text-center mb-6 max-w-md">
        Create multiple versions of your baseline forecast to explore different
        outcomes and plan ahead.
      </p>
      <Button onClick={onCreateScenario} className="gap-2">
        <Plus className="h-5 w-5" />
        Create your first scenario
      </Button>
    </div>
  );
}
