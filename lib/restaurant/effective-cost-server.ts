// lib/restaurant/effective-cost-server.ts
//
// Adds «costo efectivo» to the lines of the recipe editor's state (display
// only: stored costs and approved recipes are never rewritten). Reads the
// yields and the kitchen buffer in force today for the selected restaurant.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EditorState } from "@/lib/restaurant/recipe-costing/editor-service";
import { effectiveLineCost } from "@/lib/restaurant/effective-cost";
import {
  coveredByMeasuredPrep,
  missingYield,
  type PrepNode,
} from "@/lib/restaurant/nested-yield";
import { loadPrepGraph } from "@/lib/restaurant/nested-yield-server";
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
    // The preparation graph decides «covered» at any depth and which
    // preparation lines lack a measured batch output. If it cannot be read,
    // fall back to the open preparation's own yield.
    let graph = new Map<string, PrepNode>();
    try {
      graph = await loadPrepGraph(supabase, companyId);
    } catch (err) {
      console.error("[recipes/editor] preparation graph failed:", err);
    }
    const self = state.preparation;
    const measuredSelf = self?.yield?.confirmed === true;
    if (self)
      graph.set(self.component_id, {
        id: self.component_id,
        measured: measuredSelf,
        children: graph.get(self.component_id)?.children ?? [],
      });
    const measured = self
      ? coveredByMeasuredPrep(self.component_id, graph)
      : false;
    if (self) self.yield_missing = !measuredSelf;
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
      if (line.kind === "component" && line.component_id) {
        const node = graph.get(line.component_id);
        line.yield_missing = node ? missingYield(node) : true;
      }
    }
  } catch (err) {
    // A display extra: the editor keeps working without it.
    console.error("[recipes/editor] effective cost failed:", err);
  }
}
