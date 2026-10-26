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
/** Forced refreshes (after a save), one per key. Separate from `inflight`: a
 *  read that started BEFORE the save must never answer a refresh. */
const refreshing = new Map<string, Promise<RecipeCostingWorkspace | null>>();
let generation = 0;
/** Bumped by every invalidation; a read that started before it is stale. */
let epoch = 0;

export function tabEpoch(): number {
  return epoch;
}

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
  epoch++;
  // Still shown at once, but no longer "fresh": the next visit re-reads.
  for (const entry of entries.values()) {
    entry.at = Math.min(entry.at, now - TAB_FRESH_MS - 1);
  }
}

export function clearTabs(): void {
  entries.clear();
  inflight.clear();
  refreshing.clear();
  generation++;
}

/**
 * One read per tab at a time. A save while the read is on its way makes its
 * answer possibly pre-save: it is never cached or returned; the read is
 * repeated (twice at most) and, if saves keep arriving, the answer is null
 * so the caller keeps what it has or loads the page normally.
 */
export function loadTab(
  key: string,
  load: () => Promise<RecipeCostingWorkspace | null>
): Promise<RecipeCostingWorkspace | null> {
  return runShared(inflight, key, load);
}

/**
 * A read that IGNORES freshness (after a save, an import, a reset): always goes
 * to the network, but concurrent callers for the same key share ONE request
 * (four hosts listening to the same event, plus the screen that caused it, are
 * one GET). Same stale-answer protection as `loadTab`.
 */
export function refreshTab(
  key: string,
  load: () => Promise<RecipeCostingWorkspace | null>
): Promise<RecipeCostingWorkspace | null> {
  return runShared(refreshing, key, load);
}

function runShared(
  running: Map<string, Promise<RecipeCostingWorkspace | null>>,
  key: string,
  load: () => Promise<RecipeCostingWorkspace | null>
): Promise<RecipeCostingWorkspace | null> {
  const shared = running.get(key);
  if (shared) return shared;
  const started = generation;
  const attempt = async (
    triesLeft: number
  ): Promise<RecipeCostingWorkspace | null> => {
    const epochAtStart = epoch;
    const data = await load();
    if (started !== generation) return data;
    if (epoch !== epochAtStart)
      return triesLeft > 0 ? attempt(triesLeft - 1) : null;
    if (data) putTab(key, data);
    return data;
  };
  const run = attempt(2)
    .catch(() => null)
    .finally(() => {
      if (running.get(key) === run) running.delete(key);
    });
  running.set(key, run);
  return run;
}
