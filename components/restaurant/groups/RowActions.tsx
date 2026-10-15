"use client";

// R1-15j: the actions of a dish or group row, as soft brand-blue chips right
// after the name. They appear while the pointer is anywhere on the row (the
// row carries `group/row`), always on touch screens, and whenever one of them
// has keyboard focus.

import { BarChart3, FileText } from "lucide-react";

const CHIP =
  "inline-flex items-center gap-1 rounded-md border border-[#c6d3f5] bg-[#eef2fc] px-2 py-0.5 text-[12px] font-semibold text-[#1b40c8] hover:border-[#1b40c8] hover:bg-[#dfe7fb]";

export function RowActions({
  onDrill,
  onRecipe,
}: {
  onDrill?: () => void;
  onRecipe?: () => void;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100"
      data-testid="row-actions"
    >
      {onDrill ? (
        <button type="button" onClick={onDrill} className={CHIP}>
          <BarChart3 className="h-3.5 w-3.5" aria-hidden />
          Desglose
        </button>
      ) : null}
      {onRecipe ? (
        <button type="button" onClick={onRecipe} className={CHIP}>
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Receta
        </button>
      ) : null}
    </span>
  );
}
