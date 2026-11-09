// lib/restaurant/ingredient-yield-view.ts
//
// The yield loss to SHOW for an ingredient today, from its history lines: the
// value on a date is the most recently created row with effective_from <=
// that date (yield-buffer.ts pickValueAt). The history entries are exactly
// those rows (newest first), so the current value is derived from them and a
// missing yield stays null (never 0).

import { pickValueAt, type HistoryEntry } from "@/lib/restaurant/yield-buffer";

export function currentYield(
  history: ReadonlyArray<
    Pick<HistoryEntry, "id" | "createdAt" | "effectiveFrom" | "newPct">
  >,
  date: string
): number | null {
  const hit = pickValueAt(
    history.map((h) => ({
      id: h.id,
      created_at: h.createdAt,
      effective_from: h.effectiveFrom,
      pct: h.newPct,
    })),
    date
  );
  return hit ? Number(hit.pct) : null;
}
