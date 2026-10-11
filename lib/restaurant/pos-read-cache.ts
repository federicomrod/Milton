// lib/restaurant/pos-read-cache.ts
//
// Per-request React cache. Tabs/menu/costs share one profitability
// load (product rollup when 033 is applied). Sales still pages rows
// via loadCachedPosSalesRows when the explorer needs them.

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
    const selected: ProfitabilitySelection | null = locationId
      ? { locationId, brandId }
      : null;
    return fetchProfitabilityData(supabase, companyId, selected);
  }
);
