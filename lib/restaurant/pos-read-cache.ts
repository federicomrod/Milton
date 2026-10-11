// lib/restaurant/pos-read-cache.ts
//
// Per-request React cache so cockpit executive, tabs, menu, and costs
// share one POS page-walk instead of each firing its own.

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchCompanyPosSalesRows } from "@/lib/restaurant/supabase-sales";
import {
  fetchProfitabilityData,
  type ProfitabilityData,
  type ProfitabilitySelection,
} from "@/lib/restaurant/profitability-server";

export const loadCachedPosSalesRows = cache(
  async (companyId: string, locationId: string | null) => {
    const supabase = await createClient();
    return fetchCompanyPosSalesRows(supabase, companyId, locationId);
  }
);

export const loadCachedProfitability = cache(
  async (
    companyId: string,
    locationId: string | null,
    brandId: string | null
  ): Promise<ProfitabilityData> => {
    const supabase = await createClient();
    const pos = await loadCachedPosSalesRows(companyId, locationId);
    const selected: ProfitabilitySelection | null = locationId
      ? { locationId, brandId }
      : null;
    return fetchProfitabilityData(supabase, companyId, selected, {
      posRows: pos.error ? undefined : pos.rows,
    });
  }
);
