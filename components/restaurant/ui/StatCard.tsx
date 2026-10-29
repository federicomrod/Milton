// components/restaurant/ui/StatCard.tsx
//
// The Cockpit stat card (label · big value · sub · chips · note), with the
// exact classes of CockpitV2's Card, plus an optional badge next to the label.

import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  sub,
  chips,
  note,
  badge,
  labelTitle,
}: {
  label: string;
  value: string;
  sub?: string;
  chips?: ReactNode;
  note?: string | null;
  badge?: ReactNode;
  /** Tooltip of the label (how a projection is estimated). */
  labelTitle?: string;
}) {
  return (
    <div className="rounded-[14px] border border-[#dbe3f7] bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[#6b7385]">
        <span title={labelTitle}>{label}</span>
        {badge}
      </div>
      <div className="mt-0.5 text-[30px] font-extrabold leading-tight tracking-[-0.5px] text-[#1b2333]">
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 text-[12px] text-[#8a92a3]">{sub}</div>
      ) : null}
      {chips ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">{chips}</div>
      ) : null}
      {note ? (
        <div className="mt-1 text-[12px] text-[#8a92a3]">{note}</div>
      ) : null}
    </div>
  );
}
