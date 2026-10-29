// lib/restaurant/sales-detail-insights.ts
//
// What the Ventas page says about the period on screen, deterministic and pure
// (no AI call, no I/O): the leader of each dimension, computed from the cube's
// view (computeDetail), so it follows the filters.

import type { DimRow } from "@/lib/restaurant/sales-detail";

export interface DimensionLeader {
  label: string;
  share: number;
}

/** «En salón · 94.2%»: the row with the most sales. Nothing sold = no leader. */
export function dimensionLeader(
  rows: readonly Pick<DimRow, "label" | "net" | "share">[]
): DimensionLeader | null {
  let best: Pick<DimRow, "label" | "net" | "share"> | null = null;
  for (const row of rows)
    if (row.net > 0 && (!best || row.net > best.net)) best = row;
  return best ? { label: best.label, share: best.share } : null;
}

export function leaderLabel(leader: DimensionLeader): string {
  return `${leader.label} · ${leader.share.toFixed(1)}%`;
}
