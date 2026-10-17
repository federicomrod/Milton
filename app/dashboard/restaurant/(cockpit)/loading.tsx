// app/dashboard/restaurant/(cockpit)/loading.tsx
//
// Final-dimension skeletons so the executive layout does not jump.

import { CockpitHeadlineSkeleton } from "@/components/restaurant/cockpit/CockpitHeadline";
import { CockpitHeroChartSkeleton } from "@/components/restaurant/cockpit/CockpitHeroChart";
import { CockpitInsightsCardSkeleton } from "@/components/restaurant/cockpit/CockpitInsightsCard";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

export default function RestaurantCockpitLoading() {
  return (
    <div className="w-full py-3 px-6 lg:px-10">
      <div className="space-y-3">
        <PageSkeleton height="2rem" width="16rem" label="period" />
        <CockpitHeadlineSkeleton />
        <PageSkeleton height="4.5rem" width="100%" label="kpi strip" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          <div className="lg:col-span-2">
            <CockpitHeroChartSkeleton />
          </div>
          <PageSkeleton height="220px" width="100%" label="channels" />
        </div>
        <CockpitInsightsCardSkeleton />
      </div>
    </div>
  );
}
