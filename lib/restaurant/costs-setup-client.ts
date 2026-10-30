// lib/restaurant/costs-setup-client.ts
//
// Client helpers shared by the Costos setup pieces: the one request that reads
// the setup (Resumen) payload, and the «de hace N días» label of the last file.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";

export async function fetchSetup(
  locationId: string | null
): Promise<RecipeCostingWorkspace | null> {
  const q = new URLSearchParams({ vista: "resumen" });
  if (locationId) q.set("location_id", locationId);
  const res = await fetch(`/api/restaurant/recipes/costing?${q.toString()}`);
  return res.ok ? ((await res.json()) as RecipeCostingWorkspace) : null;
}

export function ageLabel(
  createdAt: string | null | undefined,
  now: number,
  lang: PreferredLanguage = "es"
): string | null {
  const s = getDictionary(lang).costs.setup;
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0
    ? s.ageToday
    : days === 1
      ? s.ageOneDay
      : fmt(s.ageDays, { n: days });
}
