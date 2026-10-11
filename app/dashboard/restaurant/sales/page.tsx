// app/dashboard/restaurant/sales/page.tsx
//
// Thin Sales area — heatmap from the fast rollup, explorer streamed after
// the POS page-walk. Layout of the Sales tab is unchanged.

import { Suspense } from "react";
import {
  loadSalesExplorerModel,
  loadSalesHeroModel,
} from "@/lib/restaurant/cockpit-page-data";
import { SalesHero } from "@/components/restaurant/cockpit/SalesHero";
import { RestaurantSalesExplorer } from "@/components/restaurant/RestaurantSalesExplorer";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
} from "@/lib/restaurant/language";
import { shownPeriodFromSales } from "@/lib/restaurant/page-date-range";

export const dynamic = "force-dynamic";

async function SalesHeroSection({ location }: { location?: string }) {
  const hero = await loadSalesHeroModel(location);
  if (hero.mode !== "live") {
    return (
      <NotAvailableYet
        lang={hero.lang}
        reason={t(
          hero.lang,
          "Upload POS sales to see the heatmap and explorer.",
          "Importa ventas del POS para ver el mapa de calor y el explorador."
        )}
        href="/dashboard/restaurant/upload"
        linkLabel={t(
          hero.lang,
          "Import POS Sales →",
          "Importar ventas del POS →"
        )}
      />
    );
  }
  return <SalesHero cockpit={hero.cockpit} lang={hero.lang} />;
}

async function SalesExplorerSection({ location }: { location?: string }) {
  const model = await loadSalesExplorerModel(location);
  if (model.mode !== "live") return null;
  return (
    <section>
      <RestaurantSalesExplorer
        rows={model.explorerRows}
        initialTargets={model.targets}
        displayCurrency={model.displayCurrency}
        lang={model.lang}
      />
    </section>
  );
}

export default async function SalesAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const hero = await loadSalesHeroModel(location);
  const lang =
    hero.mode === "live" ? hero.lang : RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <OperatingPageHeader
        title={t(lang, "Sales", "Ventas")}
        lang={lang}
        shownRange={
          hero.mode === "live"
            ? shownPeriodFromSales(
                hero.cockpit.period_from,
                hero.cockpit.period_to
              )
            : null
        }
      />
      <Suspense
        fallback={<PageSkeleton height="220px" width="100%" label="heatmap" />}
      >
        <SalesHeroSection location={location} />
      </Suspense>
      {hero.mode === "live" ? (
        <Suspense
          fallback={
            <PageSkeleton height="320px" width="100%" label="explorer" />
          }
        >
          <SalesExplorerSection location={location} />
        </Suspense>
      ) : null}
    </div>
  );
}
