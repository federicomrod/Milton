"use client";

// R1-15e: the sort of a table, remembered for the session (per table id).

import { useCallback, useEffect, useState } from "react";
import { nextSort, type SortState } from "@/lib/restaurant/table-sort";

const memory = new Map<string, SortState | null>();
const KEY = (id: string) => `milton:sort:${id}`;

export function useTableSort(
  tableId: string,
  fallback: SortState | null = null
) {
  const [chosen, setChosen] = useState<SortState | null>(
    () => memory.get(tableId) ?? null
  );

  // A reload keeps it too (sessionStorage), read after the first paint.
  useEffect(() => {
    if (memory.has(tableId)) return;
    try {
      const raw = window.sessionStorage.getItem(KEY(tableId));
      if (!raw) return;
      const parsed = JSON.parse(raw) as SortState | null;
      if (parsed && typeof parsed.key === "string") {
        memory.set(tableId, parsed);
        queueMicrotask(() => setChosen(parsed));
      }
    } catch {
      // No storage: it just starts at the default.
    }
  }, [tableId]);

  const toggle = useCallback(
    (key: string) => {
      const next = nextSort(chosen, key, fallback);
      memory.set(tableId, next);
      try {
        if (next)
          window.sessionStorage.setItem(KEY(tableId), JSON.stringify(next));
        else window.sessionStorage.removeItem(KEY(tableId));
      } catch {
        // ignore
      }
      setChosen(next);
    },
    [chosen, fallback, tableId]
  );

  /** What is applied now: the person's choice, else the table's default. */
  return { sort: chosen ?? fallback, toggle };
}
