// lib/restaurant/effective-cost-server.ts
//
// Adds «costo efectivo» to the lines of the recipe editor's state (display
// only: stored costs and approved recipes are never rewritten). Reads the
// yields and the kitchen buffer in force today for the selected restaurant.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import { loadBusinessToday } from "@/lib/restaurant/kitchen-buffer-server";
import { listAllCompanyRestaurants } from "@/lib/restaurant/restaurant-context-server";
import {
  loadResolvedBufferAt,
  loadYieldsAt,
} from "@/lib/restaurant/yield-buffer";

export async function attachEffectiveCosts(
  supabase: SupabaseClient,
  companyId: string,
  locationId: string | null,
  state: EditorState
): Promise<void> {
  try {
    const { locations } = await listAllCompanyRestaurants(supabase, companyId);
    const where =
      locationId && locations.some((l) => l.id === locationId)
        ? locationId
        : (locations[0]?.id ?? null);
    if (!where) return;
    const today = await loadBusinessToday(supabase, companyId, where);
    const ingredientIds = state.lines
      .map((l) => l.ingredient_id)
      .filter((id): id is string => !!id);
    const [buffer, yields] = await Promise.all([
      loadResolvedBufferAt(supabase, companyId, where, today),
      loadYieldsAt(supabase, companyId, ingredientIds, today),
    ]);
    const measured = state.preparation?.yield?.confirmed === true;
    for (const line of state.lines) {
      const r = effectiveLineCost({
        amount: line.amount,
        kind: line.kind,
        ownCost: line.own_cost,
        ownYieldLossPct: line.ingredient_id
          ? (yields.get(line.ingredient_id)?.lossPct ?? null)
          : null,
        insideMeasuredPrep: measured,
        bufferPct: buffer.bufferPct,
      });
      line.effective = r;
    }
  } catch (err) {
    // A display extra: the editor keeps working without it.
    console.error("[recipes/editor] effective cost failed:", err);
  }
}
