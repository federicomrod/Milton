// lib/restaurant/menu-estimate-probe-cache.ts
//
// The «Estimar con Milton» check (GET /api/restaurant/recipes/menu/estimate)
// is heavy on the server, and Menú › Resumen and Menú › Platos ask it every
// time they mount. This keeps its answer for as long as a Menú tab is
// considered fresh (TAB_FRESH_MS), shares a read that is already on its way,
// and forgets everything after an estimate run or any save that marks the tabs
// stale. A failed read is never cached. Client-only; the route is unchanged.

import {
  onTabsInvalidated,
  TAB_FRESH_MS,
} from "@/lib/restaurant/recipe-costing/menu-tab-cache";

interface Entry<T> {
  at: number;
  data: T;
}

const entries = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
/** Bumped by every invalidation: a read that started before it is not cached. */
let version = 0;

export function invalidateEstimateProbe(): void {
  version++;
  entries.clear();
  inflight.clear();
}

// Any save that other Menú tabs show (approval, price, link, import, reset).
onTabsInvalidated(invalidateEstimateProbe);

export function loadEstimateProbe<T>(
  locationId: string | null,
  load: () => Promise<T>,
  now: number = Date.now()
): Promise<T> {
  const key = locationId ?? "";
  const hit = entries.get(key) as Entry<T> | undefined;
  if (hit && now - hit.at <= TAB_FRESH_MS) return Promise.resolve(hit.data);
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const started = version;
  const run = load()
    .then((data) => {
      if (started === version) entries.set(key, { at: Date.now(), data });
      return data;
    })
    .finally(() => {
      if (inflight.get(key) === run) inflight.delete(key);
    });
  inflight.set(key, run);
  return run;
}
