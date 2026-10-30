// app/dashboard/restaurant/(cockpit)/page.tsx
//
// Restaurant cockpit (Cockpit v2). With sales: the live Cockpit. Without them
// (no POS yet, no company, a read error): the SAME Cockpit v2 layout in an
// empty state — «—» / «Sin datos aún» and a clear way forward. There is no
// mock / sample data path any more: no invented number or dish name is ever
// drawn for a real account, and the currency is the company's setting.
//
// This page lives under app/dashboard/restaurant/ like every other restaurant
// page (in the `(cockpit)` group, which keeps the URL /dashboard/restaurant and
// scopes this skeleton to the Cockpit): ONE layout (one RestaurantShell) for all of /dashboard/restaurant/*, so
// switching Cockpit ↔ Menú ↔ Ventas does not remount the sidebar or lose caches.
// (app/dashboard/layout.tsx already skips its legacy work on restaurant paths.) Server Component: Supabase access uses the SSR
// client, so the user's session cookie is honored and RLS applies.

import { AlertTriangle } from "lucide-react";
import { Suspense } from "react";
import { PAGINATED_READ_SAFETY_CAP } from "@/lib/restaurant/paginated-read";
import {
  loadCockpitExecutiveFast,
  type CockpitExecutiveFastModel,
} from "@/lib/restaurant/cockpit-page-data";
import { CockpitV2 } from "@/components/restaurant/cockpit/v2/CockpitV2";
import { CockpitEmpty } from "@/components/restaurant/cockpit/v2/CockpitEmpty";
import { loadCockpitV2Model } from "@/lib/restaurant/cockpit-v2-server";
import { CockpitHeadlineSkeleton } from "@/components/restaurant/cockpit/CockpitHeadline";
import { CockpitHeroChartSkeleton } from "@/components/restaurant/cockpit/CockpitHeroChart";
import { CockpitInsightsCardSkeleton } from "@/components/restaurant/cockpit/CockpitInsightsCard";
import { fmt, getDictionary } from "@/lib/i18n";
import { localeFor } from "@/lib/restaurant/language";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { DataHealthBanner } from "@/components/restaurant/shell/DataHealthIndicator";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";

// Force runtime rendering (no static cache); session cookies are read.
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Page entry — live Cockpit, or the same Cockpit empty.
// ---------------------------------------------------------------------------

async function CockpitLiveBody({
  location,
  period,
}: {
  location?: string;
  period?: string;
}) {
  const fast: CockpitExecutiveFastModel = await loadCockpitExecutiveFast(
    location,
    period
  );
  if (fast.mode !== "live") {
    return (
      <div className="w-full px-[26px] pt-4 pb-10 space-y-3">
        <OperatingPageHeader
          title={getDictionary(fast.lang).cockpit.page.title}
          lang={fast.lang}
          showDateRange={false}
          lastSyncedAt={fast.lastSyncedAt}
        />
        <CockpitEmpty reason={fast.reason ?? "no_sales"} lang={fast.lang} />
      </div>
    );
  }
  const lang = fast.lang;
  const d = getDictionary(lang).cockpit;
  const model = await loadCockpitV2Model(fast);
  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-3">
      <OperatingPageHeader
        title={d.page.title}
        lang={lang}
        showDateRange={false}
        lastSyncedAt={fast.lastSyncedAt}
      />
      {fast.readError ? (
        <DataHealthBanner tone="error">{d.page.readError}</DataHealthBanner>
      ) : null}
      {fast.truncated && (
        <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-950/20 p-3 text-sm text-red-900 dark:text-red-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            {fmt(d.page.truncated, {
              rows: PAGINATED_READ_SAFETY_CAP.toLocaleString(localeFor(lang)),
            })}
          </span>
        </div>
      )}
      {/* R1-16b: the Cockpit v2. One dataset, all filtering in the browser. */}
      {model.refDay ? (
        <CockpitV2
          currency={fast.currency}
          daily={model.daily}
          refDay={model.refDay}
          today={model.today}
          firstDay={model.firstDay}
          targets={model.targets}
          restaurants={model.restaurants}
          locationId={fast.scope?.locationId ?? null}
          defaultComparison={model.defaultComparison}
          lang={lang}
        />
      ) : (
        <CockpitEmpty reason="no_sales" lang={lang} />
      )}
    </div>
  );
}

export default async function RestaurantCockpitPage({
  searchParams,
}: {
  // Next.js 15+/16: searchParams is a Promise in a page Server Component.
  searchParams: Promise<{ location?: string; period?: string }>;
}) {
  const { location: requestedLocationId, period } = await searchParams;
  return (
    <Suspense fallback={<RestaurantCockpitLoadingFallback />}>
      <CockpitLiveBody location={requestedLocationId} period={period} />
    </Suspense>
  );
}

function RestaurantCockpitLoadingFallback() {
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
