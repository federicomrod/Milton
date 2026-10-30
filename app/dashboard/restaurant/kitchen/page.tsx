// app/dashboard/restaurant/kitchen/page.tsx
//
// Kitchen area — needs-attention feed (#148). KPI math stays in
// lib/restaurant/kitchen-insights.ts. Same period shell as Sales.

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { loadKitchenPageModel } from "@/lib/restaurant/kitchen-page-data";
import { parseKitchenExploreTab } from "@/lib/restaurant/kitchen-explore";
import { timeCockpitStep } from "@/lib/restaurant/cockpit-timing";
import { KitchenPageLive } from "@/components/restaurant/kitchen/KitchenPageLive";
import { KitchenPageHeader } from "@/components/restaurant/kitchen/KitchenPageChrome";
import { KitchenHighlights } from "@/components/restaurant/kitchen/KitchenHighlights";
import { KitchenHighlightsUpgrade } from "@/components/restaurant/kitchen/KitchenHighlightsUpgrade";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
} from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{
    location?: string;
    period?: string;
    tab?: string;
  }>;
}) {
  const { location, period, tab } = await searchParams;
  const model = await timeCockpitStep(
    "kitchen-route",
    () => loadKitchenPageModel(location, period),
    { location: location ?? null, period: period ?? null }
  );
  const lang = model.lang || RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;

  if (!model.companyId) {
    redirect("/dashboard/restaurant");
  }

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <KitchenPageHeader
        lang={lang}
        periodPreset={model.periodPreset}
        range={model.period?.current ?? null}
        comparisonLabel={model.comparisonLabel}
        periodAskQuestion={model.insights?.period_ask_question}
      />
      {model.insights ? (
        <KitchenPageLive
          insights={model.insights}
          lang={lang}
          canManage={model.canManage}
          canManageDrafts={model.canManageDrafts}
          locations={model.locations}
          initialTab={tab ? parseKitchenExploreTab(tab) : undefined}
        >
          <Suspense
            fallback={
              <KitchenHighlights
                highlights={model.insights.highlights}
                empty={model.insights.empty_feed}
                lang={lang}
                source="deterministic"
              />
            }
          >
            <KitchenHighlightsUpgrade
              highlights={model.insights.highlights}
              facts={model.insights.insightFacts}
              empty={model.insights.empty_feed}
              lang={lang}
              cacheKey={model.insightCacheKey}
            />
          </Suspense>
        </KitchenPageLive>
      ) : (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "Kitchen reports from your team will show up here.",
            "Aquí aparecerán los reportes de cocina de tu equipo.",
            "Hier erscheinen die Küchenmeldungen Ihres Teams."
          )}
        />
      )}
    </div>
  );
}
