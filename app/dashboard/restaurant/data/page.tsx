// app/dashboard/restaurant/data/page.tsx
//
// Data & Settings hub — simple link lists for now (PR 1). Full Data
// Health drawer arrives in PR 2.

import Link from "next/link";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { DEFAULT_LANGUAGE } from "@/lib/restaurant/language";
import {
  DATA_SETTINGS_HREF,
  dataSettingsLinkLabel,
  dataSettingsSectionLabel,
  routesForSection,
  type DataSettingsSectionId,
} from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

const SECTIONS: DataSettingsSectionId[] = [
  "data_sources",
  "data_health",
  "setup",
  "team",
  "account",
];

export default function DataSettingsPage() {
  const lang: PreferredLanguage = DEFAULT_LANGUAGE;

  return (
    <div className="w-full py-3 px-6 lg:px-10 space-y-6 max-w-3xl">
      <OperatingPageHeader
        title={t(lang, "Data & Settings", "Datos y ajustes")}
        lang={lang}
        showDateRange={false}
      />
      <p className="text-sm text-muted-foreground">
        {t(
          lang,
          "Sources, setup and account. Every previous page is still here.",
          "Fuentes, configuración y cuenta. Todas las páginas anteriores siguen aquí."
        )}
      </p>

      <section id="data-health" className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {dataSettingsSectionLabel("data_health", lang)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            lang,
            "Row counts, POS source notes and costing gaps live behind the Data health control on each operating page. A full drawer comes next.",
            "Los conteos de filas, notas del POS y huecos de costeo viven detrás del control de salud de datos en cada página. El panel completo llega después."
          )}
        </p>
        <Link
          href={`${DATA_SETTINGS_HREF}#data-health`}
          className="text-sm font-medium text-primary hover:underline"
        >
          {t(lang, "Data health", "Salud de los datos")}
        </Link>
      </section>

      {SECTIONS.filter((s) => s !== "data_health").map((section) => {
        const links = routesForSection(section);
        if (links.length === 0) return null;
        return (
          <section key={section} className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {dataSettingsSectionLabel(section, lang)}
            </h2>
            <ul className="divide-y divide-border rounded-md border border-border bg-background">
              {links.map((route) => (
                <li key={route.id}>
                  <Link
                    href={route.href}
                    className="block px-4 py-2.5 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                  >
                    {dataSettingsLinkLabel(route.id, lang)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
