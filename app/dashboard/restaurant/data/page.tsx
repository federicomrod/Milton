// app/dashboard/restaurant/data/page.tsx
//
// Configuración (R1-09b, A10/A11): three sections only — Conexiones,
// Equipo (admins), Cuenta. Ingredients, suppliers, invoices and cost files
// live in Menú and Costos now. The POS sales uploader is a panel here
// (the old /upload page redirects to ?seccion=conexiones).

import Link from "next/link";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { PosSalesUploadPanel } from "@/components/restaurant/settings/PosSalesUploadPanel";
import { t } from "@/lib/restaurant/language";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  DATA_SETTINGS_SECTIONS,
  DATA_SETTINGS_SECTION_ANCHORS,
  dataSettingsLinkLabel,
  dataSettingsSectionLabel,
  routesForSection,
} from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

const linkClass =
  "block px-4 py-2.5 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500";

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ seccion?: string }>;
}) {
  const [{ lang, isAdmin }, { seccion }] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  const uploadOpen = seccion === DATA_SETTINGS_SECTION_ANCHORS.connections;

  return (
    <div className="w-full px-[26px] pt-4 pb-10 space-y-6 max-w-3xl">
      <OperatingPageHeader
        title={t(lang, "Settings", "Configuración")}
        lang={lang}
        showDateRange={false}
      />

      {DATA_SETTINGS_SECTIONS.map((section) => {
        const links = routesForSection(section, { isAdmin });
        if (links.length === 0) return null;
        return (
          <section
            key={section}
            id={DATA_SETTINGS_SECTION_ANCHORS[section]}
            className="space-y-2 scroll-mt-4"
          >
            <h2 className="text-[15px] font-semibold text-[#151c2c]">
              {dataSettingsSectionLabel(section, lang)}
            </h2>
            <ul className="divide-y divide-border rounded-[14px] border border-[#dfe3ea] bg-white">
              {links.map((route) =>
                route.id === "pos-sales" ? (
                  <li key={route.id}>
                    <details open={uploadOpen} className="group">
                      <summary
                        className={`${linkClass} cursor-pointer list-none flex items-center justify-between`}
                      >
                        {dataSettingsLinkLabel(route.id, lang)}
                        <span
                          aria-hidden
                          className="text-[#6b7385] transition-transform group-open:rotate-90"
                        >
                          ›
                        </span>
                      </summary>
                      <div className="px-4 pb-4 pt-1">
                        <PosSalesUploadPanel lang={lang} />
                      </div>
                    </details>
                  </li>
                ) : (
                  <li key={route.id}>
                    <Link href={route.href} className={linkClass}>
                      {dataSettingsLinkLabel(route.id, lang)}
                    </Link>
                  </li>
                )
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
