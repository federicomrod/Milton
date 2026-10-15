"use client";

// R1-18: reads the one dataset of Menú › Resumen once (after the page paints),
// keeps it for the session and re-reads it in the background after a save (the
// Menú tab cache's epoch). Everything else is computed in the browser.

import { useEffect, useState } from "react";
import type { ResumenData } from "@/lib/restaurant/menu-resumen";
import { tabEpoch } from "@/lib/restaurant/recipe-costing/menu-tab-cache";

interface Entry {
  data: ResumenData;
  at: number;
  epoch: number;
}
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<ResumenData | null>>();
const FRESH_MS = 60_000;

function read(locationId: string | null): Promise<ResumenData | null> {
  const key = locationId ?? "";
  const running = inflight.get(key);
  if (running) return running;
  const epoch = tabEpoch();
  const q = new URLSearchParams();
  if (locationId) q.set("location_id", locationId);
  const run = fetch(
    `/api/restaurant/menu-resumen-days${q.size ? `?${q.toString()}` : ""}`
  )
    .then((res) => (res.ok ? (res.json() as Promise<ResumenData>) : null))
    .then((data) => {
      if (data) cache.set(key, { data, at: Date.now(), epoch });
      return data;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

export function useResumenData(locationId: string | null): {
  data: ResumenData | null;
  failed: boolean;
  retry: () => void;
} {
  const key = locationId ?? "";
  const [answer, setAnswer] = useState<{
    key: string;
    data: ResumenData | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const cached = cache.get(key);
  useEffect(() => {
    let cancelled = false;
    const entry = cache.get(key);
    const stale =
      !entry || entry.epoch !== tabEpoch() || Date.now() - entry.at > FRESH_MS;
    if (!stale) return;
    void read(locationId).then((data) => {
      if (!cancelled) setAnswer({ key: `${key}|${attempt}`, data });
    });
    return () => {
      cancelled = true;
    };
  }, [key, locationId, attempt]);
  const fresh = answer && answer.key.startsWith(`${key}|`) ? answer.data : null;
  const data = fresh ?? cached?.data ?? null;
  const failed = !data && answer !== null && answer.key.startsWith(`${key}|`);
  return { data, failed, retry: () => setAttempt((a) => a + 1) };
}
