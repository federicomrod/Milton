// app/dashboard/restaurant/sales/page.tsx
//
// Sales area — Understand / Explore. Investigate lives one level deeper
// at /detalle. KPI math stays in lib/restaurant/sales-insights.ts.
// First paint uses the cached rollup/POS path from #136 and does not
// serialize explorer rows.

import { Suspense } from "react";
import { loadSalesPageModel } from "@/lib/restaurant/sales-page-data";
import { SalesUnderstand } from "@/components/restaurant/sales/SalesUnderstand";
import { SalesExplore } from "@/components/restaurant/sales/SalesExplore";
import { SalesInterpretation } from "@/components/restaurant/sales/SalesInterpretation";
import { SalesInterpretationUpgrade } from "@/components/restaurant/sales/SalesInterpretationUpgrade";
import { SalesPageHeader } from "@/components/restaurant/sales/SalesPageChrome";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { PageSkeleton } from "@/components/restaurant/shell/PageSkeleton";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
} from "@/lib/restaurant/language";
import { SALES_DETAIL_HREF } from "@/lib/restaurant/navigation";
import { salesHref } from "@/lib/restaurant/sales-explore";

export const dynamic = "force-dynamic";

export default async function SalesAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; period?: string }>;
}) {
  const { location, period } = await searchParams;
  const {
    mode,
    lang: modelLang,
    sales,
    periodPreset,
    latestSaleDate,
  } = await loadSalesPageModel(location, period);
  const lang = modelLang || RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;
  const detailHref = salesHref(SALES_DETAIL_HREF, {
    locationId: location,
    period: periodPreset,
  });

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <SalesPageHeader
        lang={lang}
        periodPreset={periodPreset}
        range={
          sales
            ? sales.period.current
            : mode === "live" && latestSaleDate
              ? { from: latestSaleDate, to: latestSaleDate }
              : null
        }
        comparisonLabel={sales?.comparisonLabel}
      />
      {mode === "live" && sales ? (
        <>
          <SalesUnderstand
            insights={sales.insights}
            currency={sales.scoped.currency}
            timezone={sales.scoped.timezone}
            lang={lang}
            detailHref={detailHref}
          />
          {sales.insights.interpretation && sales.interpretationFact ? (
            <Suspense
              fallback={
                <SalesInterpretation
                  lang={lang}
                  title={sales.insights.interpretation.title}
                  body={sales.insights.interpretation.body}
                  source="deterministic"
                />
              }
            >
              <SalesInterpretationUpgrade
                fact={sales.interpretationFact}
                lang={lang}
                cacheKey={sales.interpretationCacheKey}
              />
            </Suspense>
          ) : null}
          <Suspense
            fallback={
              <PageSkeleton height="14rem" className="w-full" lang={lang} />
            }
          >
            <SalesExplore
              insights={sales.insights}
              currency={sales.scoped.currency}
              lang={lang}
              detailHref={detailHref}
            />
          </Suspense>
        </>
      ) : mode === "live" ? (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "Not enough dated sales to build this period.",
            "No hay suficientes ventas con fecha para armar este periodo."
          )}
        />
      ) : (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "Upload POS sales to see the heatmap and explorer.",
            "Importa ventas del POS para ver el mapa de calor y el explorador."
          )}
          href="/dashboard/restaurant/upload"
          linkLabel={t(lang, "Import POS Sales →", "Importar ventas del POS →")}
        />
      )}
    </div>
  );
}
