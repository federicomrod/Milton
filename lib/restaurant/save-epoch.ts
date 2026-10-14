// lib/restaurant/save-epoch.ts
//
// R1-14: the main sections (Cockpit, Ventas, Menú, Costos) are prefetched
// in full after the first load and Next keeps each payload for a minute, so
// moving between them is instant. A copy must never outlive a save: every
// successful write to /api bumps this counter, and the section links carry
// it (`?_e=N`), so after a save the next click is a different URL = a fresh
// render instead of a stale copy. Menú's own tab cache is told too.
// Framework-free so it is unit tested without a browser.

import { markTabsStale } from "@/lib/restaurant/recipe-costing/menu-tab-cache";

let epoch = 0;
const listeners = new Set<() => void>();

export function getSaveEpoch(): number {
  return epoch;
}

export function subscribeSaveEpoch(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function bumpSaveEpoch(): void {
  epoch++;
  markTabsStale();
  for (const listener of listeners) listener();
}

/** `?_e=N` on a section link; clean URLs until the first save. */
export function withSaveEpoch(href: string, value: number): string {
  if (value <= 0) return href;
  const hash = href.indexOf("#");
  const base = hash === -1 ? href : href.slice(0, hash);
  const tail = hash === -1 ? "" : href.slice(hash);
  return `${base}${base.includes("?") ? "&" : "?"}_e=${value}${tail}`;
}

function methodOf(input: unknown, init?: { method?: string }): string {
  if (init?.method) return init.method.toUpperCase();
  if (input && typeof input === "object" && "method" in input) {
    const m = (input as { method?: string }).method;
    if (m) return m.toUpperCase();
  }
  return "GET";
}

function pathOf(input: unknown): string {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : ((input as { url?: string })?.url ?? "");
    return new URL(raw, "http://local.invalid").pathname;
  } catch {
    return "";
  }
}

/**
 * Watch writes made through `target.fetch`: a successful POST/PUT/PATCH/
 * DELETE to /api/ bumps the epoch. Idempotent; returns the uninstaller.
 */
export function installSaveEpochWatcher(target: {
  fetch: typeof fetch;
}): () => void {
  const marker = "__saveEpochWatched";
  const current = target.fetch as typeof fetch & { [marker]?: boolean };
  if (current[marker]) return () => undefined;
  const original = target.fetch;
  const watched = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = methodOf(input, init);
    const response = await original.call(target, input, init);
    if (
      method !== "GET" &&
      method !== "HEAD" &&
      method !== "OPTIONS" &&
      pathOf(input).startsWith("/api/") &&
      response.ok
    ) {
      bumpSaveEpoch();
    }
    return response;
  }) as typeof fetch & { [marker]?: boolean };
  watched[marker] = true;
  target.fetch = watched;
  return () => {
    if (target.fetch === watched) target.fetch = original;
  };
}
