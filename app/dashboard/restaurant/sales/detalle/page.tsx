// app/dashboard/restaurant/sales/detalle/page.tsx
//
// Investigate: existing lunch/dinner, mix-over-time, category grid and
// explorer. SalesHero follows the header period. The explorer is loaded
// from /api/restaurant/cockpit-sales and filtered to the same period —
// it is not serialized on the Sales first paint.

import Link from "next/link";
import { loadSalesPageModel } from "@/lib/restaurant/sales-page-data";
import { SalesHero } from "@/components/restaurant/cockpit/SalesHero";
import { DeferredSalesExplorer } from "@/components/restaurant/sales/DeferredSalesExplorer";
import { SalesPageHeader } from "@/components/restaurant/sales/SalesPageChrome";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
} from "@/lib/restaurant/language";
import { SALES_HREF } from "@/lib/restaurant/navigation";
import { salesHref } from "@/lib/restaurant/sales-explore";

export const dynamic = "force-dynamic";

export default async function SalesDetailPage({
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
  const backHref = salesHref(SALES_HREF, {
    locationId: location,
    period: periodPreset,
  });

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <SalesPageHeader
        lang={lang}
        title={t(lang, "Sales details", "Detalle de ventas")}
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
      <p className="text-xs">
        <Link
          href={backHref}
          className="font-medium text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
        >
          {t(lang, "← Back to Sales", "← Volver a Ventas")}
        </Link>
      </p>
      {mode === "live" && sales ? (
        <div className="space-y-6">
          <p
            className="text-xs text-muted-foreground"
            data-testid="sales-detail-period-note"
          >
            {t(
              lang,
              "The charts and the explorer below use the same period as the header.",
              "Los gráficos y el explorador de abajo usan el mismo periodo que el encabezado."
            )}
          </p>
          <SalesHero cockpit={sales.scoped} lang={lang} />
          <section id="categorias">
            <DeferredSalesExplorer
              locationId={location}
              period={sales.period.current}
              lang={lang}
            />
          </section>
        </div>
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
