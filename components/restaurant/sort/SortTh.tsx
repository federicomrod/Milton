"use client";

import type { ReactNode } from "react";
import type { SortState } from "@/lib/restaurant/table-sort";

/** A column header that sorts on click, with ▲/▼ on the active column. */
export function SortTh({
  sortKey,
  sort,
  onSort,
  align = "left",
  className = "px-2 py-1.5",
  children,
}: {
  sortKey: string;
  sort: SortState | null;
  onSort: (key: string) => void;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const active = sort?.key === sortKey ? sort : null;
  return (
    <th
      className={className + (align === "right" ? " text-right" : "")}
      aria-sort={
        active ? (active.dir === "desc" ? "descending" : "ascending") : "none"
      }
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={
          "inline-flex items-center gap-1 font-semibold hover:text-[#1b40c8] " +
          (active ? "text-[#1b40c8]" : "")
        }
      >
        {children}
        <span aria-hidden className="w-2.5 text-[9px] text-[#1b40c8]">
          {active ? (active.dir === "desc" ? "▼" : "▲") : ""}
        </span>
      </button>
    </th>
  );
}

/** The same control as small chips, for lists that have no table header. */
export function SortChips({
  columns,
  sort,
  onSort,
}: {
  columns: ReadonlyArray<{ key: string; label: string }>;
  sort: SortState | null;
  onSort: (key: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Ordenar"
      className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6b7385]"
    >
      <span>Ordenar:</span>
      {columns.map((c) => {
        const active = sort?.key === c.key ? sort : null;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onSort(c.key)}
            aria-pressed={!!active}
            className={
              "rounded-md px-1.5 py-0.5 font-semibold hover:text-[#1b40c8] " +
              (active ? "bg-[#dfe7fb] text-[#1b40c8]" : "")
            }
          >
            {c.label}
            {active ? (active.dir === "desc" ? " ▼" : " ▲") : ""}
          </button>
        );
      })}
    </div>
  );
}
