"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import {
  useComparison,
  type ComparisonMode,
} from "@/lib/context/ComparisonContext";

interface ComparisonSelectorProps {
  modelId?: string | null;
}

const PERIOD_OPTIONS: { value: ComparisonMode; label: string }[] = [
  { value: "prev_period", label: "vs Previous Period" },
  { value: "prev_year", label: "vs Same Period Last Year" },
  { value: "trailing_12m", label: "vs Trailing 12 Months Avg" },
];

export function ComparisonSelector({ modelId }: ComparisonSelectorProps) {
  const { comparisonMode, setComparisonMode } = useComparison();
  const [hasTargets, setHasTargets] = useState(false);

  useEffect(() => {
    if (!modelId) return;
    const supabase = createClient();
    supabase
      .from("kpi_targets")
      .select("id", { count: "exact", head: true })
      .eq("model_id", modelId)
      .limit(1)
      .then(({ count }) => setHasTargets((count ?? 0) > 0));
  }, [modelId]);

  const currentLabel =
    comparisonMode === "none"
      ? "None"
      : comparisonMode === "prev_period"
        ? "vs Prev Period"
        : comparisonMode === "prev_year"
          ? "vs Last Year"
          : comparisonMode === "trailing_12m"
            ? "vs 12m Avg"
            : "vs Target";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 font-normal">
          Compare: {currentLabel}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          onClick={() => setComparisonMode("none")}
          className="justify-between"
        >
          None
          {comparisonMode === "none" && <Check className="h-3.5 w-3.5" />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {PERIOD_OPTIONS.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => setComparisonMode(opt.value)}
            className="justify-between"
          >
            {opt.label}
            {comparisonMode === opt.value && <Check className="h-3.5 w-3.5" />}
          </DropdownMenuItem>
        ))}

        {hasTargets && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setComparisonMode("target")}
              className="justify-between"
            >
              vs Target
              {comparisonMode === "target" && <Check className="h-3.5 w-3.5" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
