"use client";

// R1-17b: one small card per shift (only with ≥ 2 active shifts). A click
// filters the page by that shift.

import type { ShiftCard } from "@/lib/restaurant/sales-detail";

export function ShiftCards({
  cards,
  hours,
  selected,
  money,
  onToggle,
}: {
  cards: ShiftCard[];
  /** shift name → "11:00–17:00" (one restaurant in view). */
  hours: Record<string, string>;
  selected: string[];
  money: (n: number, d?: number) => string;
  onToggle: (name: string, multi: boolean) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <div
      className="grid grid-cols-1 gap-2.5 sm:grid-cols-2"
      data-testid="sales-shift-cards"
    >
      {cards.map((c) => (
        <button
          key={c.name}
          type="button"
          aria-pressed={selected.includes(c.name)}
          onClick={(e) =>
            onToggle(c.name, e.metaKey || e.ctrlKey || e.shiftKey)
          }
          className={
            "rounded-[14px] border bg-white px-3 py-2.5 text-left " +
            (selected.includes(c.name)
              ? "border-[#1b40c8] ring-1 ring-[#1b40c8]"
              : "border-[#eef0f4] hover:border-[#a9bcf0]")
          }
        >
          <div className="text-[12px] text-[#8a92a3]">
            {c.name}
            {hours[c.name] ? ` · ${hours[c.name]}` : ""}
          </div>
          <div className="text-[22px] font-extrabold leading-tight">
            {money(c.net)}
          </div>
          <div className="text-[11.5px] text-[#8a92a3]">
            {Math.round(c.share)}% · {c.tickets} tickets
            {c.ticket !== null ? ` · ticket ${money(c.ticket, 2)}` : ""}
          </div>
        </button>
      ))}
    </div>
  );
}
