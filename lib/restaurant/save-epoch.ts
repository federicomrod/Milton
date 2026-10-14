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
import { clearEditors } from "@/lib/restaurant/recipe-costing/editor-cache";
import { invalidatePickerOptions } from "@/lib/restaurant/recipe-costing/picker-cache";

/**
 * Writes that change what OTHER dishes cost or show: a preparation approved,
 * a price, an ingredient, an import, a link. After one of these every dish's
 * recipe lines (and the ingredient/preparation picker) are re-read, so no
 * dish keeps telling a stale story. A plain edit of one dish's lines is not
 * in this list (that dish stores the server's answer itself).
 */
const CATALOG_WRITE_PATHS = [
  "/api/restaurant/recipes/preparations",
  "/api/restaurant/recipes/price-catalog",
  "/api/restaurant/recipes/import",
  "/api/restaurant/recipes/dish-yield",
  "/api/restaurant/ingredient-costs",
  "/api/restaurant/ingredients",
  "/api/restaurant/costs",
] as const;

export function isCatalogWrite(path: string): boolean {
  return CATALOG_WRITE_PATHS.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/")
  );
}

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

export function bumpSaveEpoch(path: string = ""): void {
  epoch++;
  markTabsStale();
  if (isCatalogWrite(path)) {
    clearEditors();
    invalidatePickerOptions();
  }
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
      bumpSaveEpoch(pathOf(input));
    }
    return response;
  }) as typeof fetch & { [marker]?: boolean };
  watched[marker] = true;
  target.fetch = watched;
  return () => {
    if (target.fetch === watched) target.fetch = original;
  };
}
