// lib/restaurant/cockpit-v2-server.ts
//
// R1-16b: what the Cockpit v2 page needs, in ONE server read: the daily net
// sales of all history (from the SQL rollup the page already uses, or the same
// days from the rows), the targets, the restaurants and the default
// comparison. Everything after that is computed in the browser.

import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import {
  loadCachedCockpitPosRollup,
  type CockpitExecutiveFastModel,
} from "@/lib/restaurant/cockpit-page-data";
import { dailyFromRollup, dailyFromRows } from "@/lib/restaurant/cockpit-daily";
import { loadCachedPosSalesRows } from "@/lib/restaurant/pos-read-cache";
import {
  loadDefaultComparison,
  loadTargetsConfig,
} from "@/lib/restaurant/supabase-targets";
import {
  parseComparison,
  type Comparison,
} from "@/lib/restaurant/cockpit-comparison";
import type { DayPoint } from "@/lib/restaurant/cockpit-math";
import type { TargetRow } from "@/lib/restaurant/objetivos";

export interface CockpitV2Model {
  daily: DayPoint[];
  refDay: string | null;
  firstDay: string | null;
  today: string;
  targets: TargetRow[];
  restaurants: Array<{ id: string; name: string }>;
  defaultComparison: Comparison;
}

export const loadCockpitV2Model = cache(
  async (fast: CockpitExecutiveFastModel): Promise<CockpitV2Model> => {
    const scope = fast.scope!;
    const supabase = await createClient();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: fast.timezone,
    }).format(new Date());
    const [rpc, config, defaultComparison, locations] = await Promise.all([
      // Already read for the header figures: the request cache makes this free.
      loadCachedCockpitPosRollup(
        scope.companyId,
        scope.locationId,
        fast.timezone,
        fast.currency
      ),
      loadTargetsConfig(supabase, scope.companyId),
      loadDefaultComparison(supabase, scope.companyId),
      supabase
        .from("restaurant_locations")
        .select("id, name")
        .eq("company_id", scope.companyId)
        .order("name", { ascending: true }),
    ]);
    const all = rpc.rollup
      ? dailyFromRollup(rpc.rollup)
      : dailyFromRows(
          (await loadCachedPosSalesRows(scope.companyId, scope.locationId))
            .rows,
          fast.timezone,
          fast.currency
        );
    // Days after today are not sales we can compare with; the series is sorted.
    const daily = all
      .filter((d) => d.date <= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    return {
      daily,
      refDay: daily.length ? daily[daily.length - 1].date : null,
      firstDay: daily.length ? daily[0].date : null,
      today,
      targets: config.rows,
      restaurants: (locations.data ?? []) as Array<{
        id: string;
        name: string;
      }>,
      defaultComparison: parseComparison(defaultComparison),
    };
  }
);
