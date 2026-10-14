// lib/restaurant/recipe-costing/menu-tab-cache.ts
//
// R1-12: the last workspace payload of each Menú tab (Resumen, Platos,
// Preparaciones) for the open restaurant and period. Going back to a tab
// shows it at once; the screen then re-reads it in the background and the
// server's answer replaces it (stale-while-revalidate), so nothing stays
// out of date. Pure and framework-free.

import type { RecipeCostingWorkspace } from "./workspace";

export type MenuTabView = "resumen" | "plato" | "preparaciones";

/** Younger than this: switching to the tab does not re-read it. */
export const TAB_FRESH_MS = 20_000;
/** Older than this: not shown (the tab loads like a first visit). */
export const TAB_KEEP_MS = 10 * 60_000;

interface Entry {
  data: RecipeCostingWorkspace;
  at: number;
}

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<RecipeCostingWorkspace | null>>();
let generation = 0;

export function menuTabKey(
  view: MenuTabView,
  shell: {
    location?: string | null;
    from?: string | null;
    to?: string | null;
  }
): string {
  return [view, shell.location ?? "", shell.from ?? "", shell.to ?? ""].join(
    "|"
  );
}

export function getCachedTab(
  key: string,
  now: number = Date.now()
): { data: RecipeCostingWorkspace; fresh: boolean } | null {
  const entry = entries.get(key);
  if (!entry) return null;
  const age = now - entry.at;
  if (age > TAB_KEEP_MS) {
    entries.delete(key);
    return null;
  }
  return { data: entry.data, fresh: age <= TAB_FRESH_MS };
}

export function putTab(
  key: string,
  data: RecipeCostingWorkspace,
  now: number = Date.now()
): void {
  entries.set(key, { data, at: now });
}

/** Any save that other tabs show (approval, price, link): re-read them. */
export function markTabsStale(now: number = Date.now()): void {
  // Still shown at once, but no longer "fresh": the next visit re-reads.
  for (const entry of entries.values()) {
    entry.at = Math.min(entry.at, now - TAB_FRESH_MS - 1);
  }
}

export function clearTabs(): void {
  entries.clear();
  inflight.clear();
  generation++;
}

/** One read per tab at a time; the result is cached unless cleared meanwhile. */
export function loadTab(
  key: string,
  load: () => Promise<RecipeCostingWorkspace | null>
): Promise<RecipeCostingWorkspace | null> {
  const running = inflight.get(key);
  if (running) return running;
  const started = generation;
  const run = load()
    .then((data) => {
      if (data && started === generation) putTab(key, data);
      return data;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}
