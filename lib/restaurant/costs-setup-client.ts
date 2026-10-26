// lib/restaurant/costs-setup-client.ts
//
// Client helpers shared by the Costos setup pieces: the one request that reads
// the setup (Resumen) payload, and the «de hace N días» label of the last file.

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
  now: number
): string | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  const days = Math.max(0, Math.floor((now - t) / 86_400_000));
  return days === 0
    ? "de hoy"
    : days === 1
      ? "de hace 1 día"
      : `de hace ${days} días`;
}
