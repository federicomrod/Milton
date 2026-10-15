// components/restaurant/cockpit/CockpitCostKpisByPeriod.tsx
//
// Picks the already-loaded Month / Last 7 cost pair for the selected
// cockpit period. No extra fetch on toggle.

"use client";

import { buildCockpitKpiStripModel } from "@/lib/restaurant/cockpit-executive";
import type { BothPeriodCostKpis } from "@/lib/restaurant/cockpit-page-data";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { useCockpitPeriodOptional } from "@/components/restaurant/cockpit/cockpit-period-context";
import {
  CockpitCostKpiCells,
  CockpitCostKpisSkeleton,
} from "@/components/restaurant/cockpit/CockpitCostKpiCells";

export function CockpitCostKpisByPeriod({
  both,
  lang,
  week,
}: {
  both: BothPeriodCostKpis;
  lang: PreferredLanguage;
  week: {
    thisWeek: { from: string; to: string } | null;
    lastWeek: { from: string; to: string } | null;
    deltaPct: number | null;
  };
}) {
  const cockpit = useCockpitPeriodOptional();
  const preset = cockpit?.preset ?? "last_7";
  const executive = cockpit?.executives[preset] ?? null;
  const pair = both[preset];
  if (!executive || !pair) return <CockpitCostKpisSkeleton />;
  const model = buildCockpitKpiStripModel(
    {
      ...executive.snapshot,
      cost: pair.cost,
      previous_cost: pair.previous_cost,
    },
    lang,
    week
  );
  return <CockpitCostKpiCells lang={lang} model={model} />;
}
