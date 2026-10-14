// lib/restaurant/recipe-costing/editor-cache.ts
//
// R1-12: what the browser remembers about a dish's recipe editor, so
// switching to a dish you just saw (or one Milton fetched ahead of time:
// the next dish after "Aprobar y siguiente", the row under the pointer)
// shows its lines at once instead of after a server round trip.
//
// Rules (a cached recipe must never be mistaken for the server's truth):
//   * a "fresh" entry (younger than EDITOR_FRESH_MS) is shown with no
//     request; an older one is shown at once AND re-read in the background
//     (stale-while-revalidate), so the server's answer always lands;
//   * every saved edit stores the server's answer for that dish; an edit
//     that changes the catalog (a price, a new ingredient) empties the
//     whole cache, because other dishes' costs just changed;
//   * approving or leaving Platos drops what it touched.
// Pure and framework-free so it is unit tested without a browser.

import type { EditorState } from "./editor-service";

/** Shown with no request while younger than this. */
export const EDITOR_FRESH_MS = 10_000;
/** Never shown once older than this. */
export const EDITOR_KEEP_MS = 5 * 60_000;
const MAX_ENTRIES = 40;

interface Entry {
  state: EditorState;
  at: number;
  /** POS product, to drop a dish after it is approved. */
  productId: number | null;
}

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
/** Bumped by clear(): reads that started before it are dropped. */
let generation = 0;

/** The query string the editor API takes (also the cache key). */
export function editorQuery(target: {
  odooProductId?: number | null;
  componentId?: string | null;
  locationId?: string | null;
}): string {
  const p = new URLSearchParams();
  if (target.componentId) {
    p.set("component_id", target.componentId);
  } else {
    if (target.odooProductId != null) {
      p.set("odoo_product_id", String(target.odooProductId));
    }
    if (target.locationId) p.set("location_id", target.locationId);
  }
  return p.toString();
}

export function getCachedEditor(
  key: string,
  now: number = Date.now()
): { state: EditorState; fresh: boolean } | null {
  const entry = entries.get(key);
  if (!entry) return null;
  const age = now - entry.at;
  if (age > EDITOR_KEEP_MS) {
    entries.delete(key);
    return null;
  }
  return { state: entry.state, fresh: age <= EDITOR_FRESH_MS };
}

export function putEditor(
  key: string,
  state: EditorState,
  opts: { productId?: number | null; now?: number } = {}
): void {
  entries.delete(key);
  entries.set(key, {
    state,
    at: opts.now ?? Date.now(),
    productId: opts.productId ?? null,
  });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function dropEditor(key: string): void {
  entries.delete(key);
}

/** After a dish is approved or sent for approval: its lines changed state. */
export function dropEditorsForProduct(productId: number): void {
  for (const [key, entry] of entries) {
    if (entry.productId === productId) entries.delete(key);
  }
}

const clearListeners = new Set<() => void>();

/** Other caches that depend on the same catalog (the screen's one-dish
 *  payloads) are told when everything is forgotten. */
export function onEditorsCleared(listener: () => void): () => void {
  clearListeners.add(listener);
  return () => {
    clearListeners.delete(listener);
  };
}

/** A catalog edit or leaving Platos: forget everything. */
export function clearEditors(): void {
  entries.clear();
  inflight.clear();
  generation++;
  for (const listener of clearListeners) listener();
}

/**
 * Read a dish ahead of time. No request when the entry is fresh or one is
 * already on its way. `load` returns null on any failure (nothing cached).
 */
export function prefetchEditor(
  key: string,
  load: () => Promise<EditorState | null>,
  opts: {
    productId?: number | null;
    now?: number;
    /** Skip the read while the cached copy is younger than this. */
    maxAgeMs?: number;
  } = {}
): Promise<void> {
  const now = opts.now ?? Date.now();
  const entry = entries.get(key);
  if (entry && now - entry.at <= (opts.maxAgeMs ?? EDITOR_FRESH_MS)) {
    return Promise.resolve();
  }
  const running = inflight.get(key);
  if (running) return running;
  const started = generation;
  const run = load()
    .then((state) => {
      if (state && started === generation) {
        putEditor(key, state, { productId: opts.productId, now: opts.now });
      }
    })
    .catch(() => undefined)
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}
