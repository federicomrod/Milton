// app/dashboard/restaurant/sales/page.tsx
//
// Thin Sales area — hosts the existing cockpit Sales tab (heatmap +
// explorer). KPI math stays in lib/; this file only loads and renders.

import { loadCockpitPageModel } from "@/lib/restaurant/cockpit-page-data";
import { RevenueAndChannelsTab } from "@/components/restaurant/cockpit/RevenueAndChannelsTab";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import {
  RESTAURANT_COCKPIT_DEFAULT_LANGUAGE,
  t,
} from "@/lib/restaurant/language";

export const dynamic = "force-dynamic";

export default async function SalesAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const { data, targets, profitability } = await loadCockpitPageModel(location);
  const lang =
    data.mode === "live"
      ? data.preferredLanguage
      : RESTAURANT_COCKPIT_DEFAULT_LANGUAGE;

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-3">
      <OperatingPageHeader title={t(lang, "Sales", "Ventas")} lang={lang} />
      {data.mode === "live" ? (
        <RevenueAndChannelsTab
          rows={data.explorerRows}
          targets={targets}
          displayCurrency={
            profitability?.kpis.currency ?? data.overview.currency
          }
          cockpit={data.cockpit}
          lang={lang}
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
