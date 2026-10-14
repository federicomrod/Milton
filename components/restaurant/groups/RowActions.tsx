"use client";

// R1-15f: the three actions of a dish row, visible on hover (always on touch)
// in the empty space between the name and Ventas. Group rows only get Desglose.

import { BarChart3, FileText, ListTree } from "lucide-react";

const BTN =
  "inline-flex items-center gap-1 rounded-md border border-[#c6d3f5] bg-[#eef2fc] px-2 py-0.5 text-[12px] font-semibold text-[#1b40c8] hover:border-[#1b40c8] hover:bg-[#dfe7fb]";

export function RowActions({
  onDrill,
  onRecipe,
  onVariants,
  variantsOpen,
}: {
  onDrill?: () => void;
  onRecipe?: () => void;
  onVariants?: () => void;
  variantsOpen?: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
      data-testid="row-actions"
    >
      {onDrill ? (
        <button type="button" className={BTN} onClick={onDrill}>
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          Desglose
        </button>
      ) : null}
      {onRecipe ? (
        <button type="button" className={BTN} onClick={onRecipe}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Receta
        </button>
      ) : null}
      {onVariants ? (
        <button
          type="button"
          className={BTN}
          onClick={onVariants}
          aria-expanded={variantsOpen}
        >
          <ListTree className="h-3.5 w-3.5" aria-hidden />
          Variantes
        </button>
      ) : null}
    </span>
  );
}
