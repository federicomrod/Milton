// lib/restaurant/cockpit-page-data.ts
//
// Shared loader for the cockpit and the thin Sales / Menu / Costs routes.
// Same fetches as the original cockpit page — no KPI math lives here.

import { createClient } from "@/lib/supabase/server";
import {
  getRestaurantKpiTargets,
  type TargetMap,
} from "@/lib/restaurant/supabase-targets";
import {
  fetchRealRestaurantDashboardData,
  resolveCompanyIdForUser,
  type RestaurantDashboardData,
} from "@/lib/restaurant/supabase-sales";
import {
  fetchProfitabilityData,
  type ProfitabilityData,
} from "@/lib/restaurant/profitability-server";
import { resolveRestaurantContext } from "@/lib/restaurant/restaurant-context-server";

export interface CockpitPageModel {
  data: RestaurantDashboardData;
  targets: TargetMap;
  profitability: ProfitabilityData | null;
}

export interface MenuAreaModel {
  profitability: ProfitabilityData | null;
}

export async function loadCockpitPageModel(
  requestedLocationId?: string
): Promise<CockpitPageModel> {
  let data: RestaurantDashboardData;
  let targets: TargetMap = {};
  let profitability: ProfitabilityData | null = null;

  try {
    const supabase = await createClient();

    let selectedLocationId: string | null = null;
    let selectedBrandId: string | null = null;
    if (requestedLocationId) {
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user?.id) {
        const companyIdForContext = await resolveCompanyIdForUser(
          supabase,
          userData.user.id
        );
        if (companyIdForContext) {
          const context = await resolveRestaurantContext(
            supabase,
            companyIdForContext,
            requestedLocationId
          );
          if (context.selected) {
            selectedLocationId = context.selected.locationId;
            selectedBrandId = context.selected.brandId;
          }
        }
      }
    }

    data = await fetchRealRestaurantDashboardData(supabase, selectedLocationId);
    if (data.mode === "live") {
      try {
        targets = await getRestaurantKpiTargets(supabase, data.companyId);
      } catch (err) {
        console.error("[loadCockpitPageModel] targets load failed:", err);
        targets = {};
      }
      try {
        profitability = await fetchProfitabilityData(
          supabase,
          data.companyId,
          selectedLocationId
            ? { locationId: selectedLocationId, brandId: selectedBrandId }
            : null,
          data.readError ? undefined : { posRows: data.posFactRows }
        );
      } catch (err) {
        console.error("[loadCockpitPageModel] profitability load failed:", err);
        profitability = null;
      }
    }
  } catch (err) {
    console.error("[loadCockpitPageModel] Supabase init failed:", err);
    data = { mode: "sample", reason: "env_missing" };
  }

  return { data, targets, profitability };
}

/**
 * Menu area only — profitability (and its own POS fact read). Does not
 * call fetchRealRestaurantDashboardData, so the Menu page avoids the
 * extra full cockpit ~20k-row load.
 */
export async function loadMenuAreaModel(
  requestedLocationId?: string
): Promise<MenuAreaModel> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.id) return { profitability: null };

    const companyId = await resolveCompanyIdForUser(supabase, user.id);
    if (!companyId) return { profitability: null };

    let selectedLocationId: string | null = null;
    let selectedBrandId: string | null = null;
    if (requestedLocationId) {
      const context = await resolveRestaurantContext(
        supabase,
        companyId,
        requestedLocationId
      );
      if (context.selected) {
        selectedLocationId = context.selected.locationId;
        selectedBrandId = context.selected.brandId;
      }
    }

    const profitability = await fetchProfitabilityData(
      supabase,
      companyId,
      selectedLocationId
        ? { locationId: selectedLocationId, brandId: selectedBrandId }
        : null
    );
    return { profitability };
  } catch (err) {
    console.error("[loadMenuAreaModel] failed:", err);
    return { profitability: null };
  }
}
