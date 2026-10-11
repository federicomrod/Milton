// components/restaurant/cockpit/CockpitCostKpis.tsx
//
// Period food-cost / margin cells for the KPI strip. Both Month and
// Last 7 days are computed in one load so a period click can swap cells
// without walking POS rows again.

import { loadBothPeriodCostKpis } from "@/lib/restaurant/cockpit-page-data";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { CockpitCostKpisByPeriod } from "@/components/restaurant/cockpit/CockpitCostKpisByPeriod";

export {
  CockpitCostKpiCells,
  CockpitCostKpisSkeleton,
} from "@/components/restaurant/cockpit/CockpitCostKpiCells";

export async function CockpitBothCostKpis({
  locationId,
  timezone,
  currency,
  lang,
  week,
}: {
  locationId?: string;
  timezone: string;
  currency: string;
  lang: PreferredLanguage;
  week: {
    thisWeek: { from: string; to: string } | null;
    lastWeek: { from: string; to: string } | null;
    deltaPct: number | null;
  };
}) {
  const both = await loadBothPeriodCostKpis(locationId, {
    timezone,
    currency,
  });
  return <CockpitCostKpisByPeriod both={both} lang={lang} week={week} />;
}
