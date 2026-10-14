"use client";

// R1-15f/h: the actions of a dish or group row, always visible right after
// the name (no hover needed): Desglose (primary) and Receta. The variants
// stay behind the ▸ caret.

import { BarChart3, FileText } from "lucide-react";

export function RowActions({
  onDrill,
  onRecipe,
}: {
  onDrill?: () => void;
  onRecipe?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-testid="row-actions"
    >
      {onDrill ? (
        <button
          type="button"
          onClick={onDrill}
          className="inline-flex items-center gap-1 rounded-md bg-[#1b40c8] px-2 py-0.5 text-[12px] font-semibold text-white hover:bg-[#1535a6]"
        >
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          Desglose
        </button>
      ) : null}
      {onRecipe ? (
        <button
          type="button"
          onClick={onRecipe}
          className="inline-flex items-center gap-1 rounded-md border border-[#c6d3f5] bg-[#eef2fc] px-2 py-0.5 text-[12px] font-semibold text-[#1b40c8] hover:border-[#1b40c8] hover:bg-[#dfe7fb]"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Receta
        </button>
      ) : null}
    </span>
  );
}
