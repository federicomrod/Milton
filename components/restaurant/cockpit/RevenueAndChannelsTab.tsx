// components/restaurant/cockpit/RevenueAndChannelsTab.tsx
//
// Existing Sales tab body (heatmap + explorer). Shared by the cockpit
// and the thin /dashboard/restaurant/sales route. No KPI math here.

import { RestaurantSalesExplorer } from "@/components/restaurant/RestaurantSalesExplorer";
import { SalesHero } from "@/components/restaurant/cockpit/SalesHero";
import type { TargetMap } from "@/lib/restaurant/supabase-targets";
import type { RestaurantDashboardData } from "@/lib/restaurant/supabase-sales";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export function RevenueAndChannelsTab({
  rows,
  targets,
  displayCurrency,
  cockpit,
  lang,
}: {
  rows: Extract<RestaurantDashboardData, { mode: "live" }>["explorerRows"];
  targets: TargetMap;
  displayCurrency?: string;
  cockpit: Extract<RestaurantDashboardData, { mode: "live" }>["cockpit"];
  lang: PreferredLanguage;
}) {
  return (
    <div className="space-y-6">
      <SalesHero cockpit={cockpit} lang={lang} />
      <section>
        <RestaurantSalesExplorer
          rows={rows}
          initialTargets={targets}
          displayCurrency={displayCurrency}
          lang={lang}
        />
      </section>
    </div>
  );
}
