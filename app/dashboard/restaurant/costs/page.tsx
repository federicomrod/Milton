// app/dashboard/restaurant/costs/page.tsx
//
// Thin Costs hub — existing supplier trends plus links to cost pages.
// Cost-page redesign is out of scope (PR 4 / #131).

import Link from "next/link";
import { loadCockpitPageModel } from "@/lib/restaurant/cockpit-page-data";
import { SupplierTrendsSection } from "@/components/restaurant/ProfitabilityCockpit";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { NotAvailableYet } from "@/components/restaurant/shell/NotAvailableYet";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  dataSettingsLinkLabel,
  routesForSection,
} from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

export default async function CostsAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string }>;
}) {
  const { location } = await searchParams;
  const { data, profitability } = await loadCockpitPageModel(location);
  const lang: PreferredLanguage =
    data.mode === "live" ? data.preferredLanguage : "en";
  const costLinks = routesForSection("data_sources").filter((route) =>
    ["import-costs", "ingredients", "suppliers", "supplier-invoices"].includes(
      route.id
    )
  );

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-4">
      <OperatingPageHeader title={t(lang, "Costs", "Costos")} lang={lang} />

      <ul className="flex flex-wrap gap-2">
        {costLinks.map((route) => (
          <li key={route.id}>
            <Link
              href={route.href}
              className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            >
              {dataSettingsLinkLabel(route.id, lang)}
            </Link>
          </li>
        ))}
      </ul>

      {profitability ? (
        <SupplierTrendsSection data={profitability} />
      ) : (
        <NotAvailableYet
          lang={lang}
          reason={t(
            lang,
            "Recipe costs required",
            "Se requieren costos de receta"
          )}
          href="/dashboard/restaurant/costs/upload"
          linkLabel={t(lang, "Add costs →", "Agregar costos →")}
        />
      )}
    </div>
  );
}
