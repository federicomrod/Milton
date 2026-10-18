// app/dashboard/restaurant/data/page.tsx
//
// Configuración: ONE page with tabs, the active one in the URL (?tab=). Each
// tab shows only its own section:
//   restaurante · rename the restaurants      conexiones · POS + sales file
//   objetivos   · the goals                   turnos     · the shifts
//   equipo      · invitations (admins)        cuenta     · account and settings
// Ingredients, suppliers, invoices and cost files live in Menú and Costos.
// The old /upload page and ?seccion=conexiones still land on Conexiones; the
// old /data/restaurante, /objetivos and /turnos routes redirect here.

import Link from "next/link";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { ConfigTabs } from "@/components/restaurant/settings/ConfigTabs";
import { PosSalesUploadPanel } from "@/components/restaurant/settings/PosSalesUploadPanel";
import { RestaurantTab } from "@/components/restaurant/settings/tabs/RestaurantTab";
import { ObjetivosTab } from "@/components/restaurant/settings/tabs/ObjetivosTab";
import { TurnosTab } from "@/components/restaurant/settings/tabs/TurnosTab";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  DATA_SETTINGS_SECTION_ANCHORS,
  dataSettingsLinkLabel,
  routesForSection,
  type DataSettingsSectionId,
} from "@/lib/restaurant/navigation";
import { parseConfigTab, type ConfigTab } from "@/lib/restaurant/config-tabs";

export const dynamic = "force-dynamic";

const linkClass =
  "block px-4 py-2.5 text-[13px] font-medium text-[#151c2c] hover:bg-[#f6f8fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#1B40C8]";

/** The one-line explanation under the title for each tab. */
function subtitle(tab: ConfigTab, lang: PreferredLanguage): string {
  switch (tab) {
    case "restaurante":
      return t(
        lang,
        "The name you see all over the app",
        "El nombre que ves en toda la app"
      );
    case "conexiones":
      return t(
        lang,
        "Where your sales come from",
        "De dónde vienen tus ventas"
      );
    case "objetivos":
      return t(
        lang,
        "Shown as lines in Cockpit and Sales",
        "Se ven como líneas en Cockpit y Ventas"
      );
    case "turnos":
      return t(
        lang,
        "How Sales splits the day and where the sales day ends",
        "Cómo Ventas reparte el día y dónde termina el día de ventas"
      );
    case "equipo":
      return t(lang, "Who can use your account", "Quién puede usar tu cuenta");
    case "cuenta":
      return t(
        lang,
        "Your profile, company and preferences",
        "Tu perfil, tu empresa y tus preferencias"
      );
  }
}

/** Rows of a tab that are plain links to a screen (Conexiones also has the sales upload). */
function LinkRows({
  section,
  isAdmin,
  lang,
  uploadOpen = false,
}: {
  section: DataSettingsSectionId;
  isAdmin: boolean;
  lang: PreferredLanguage;
  uploadOpen?: boolean;
}) {
  const links = routesForSection(section, { isAdmin });
  if (links.length === 0) {
    return (
      <p className="text-[13px] text-[#8a92a3]">
        {t(lang, "Nothing here yet.", "Aún no hay nada aquí.")}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[#eef0f4] overflow-hidden rounded-[14px] border border-[#eef0f4] bg-white">
      {links.map((route) =>
        route.id === "pos-sales" ? (
          <li key={route.id}>
            <details open={uploadOpen} className="group">
              <summary
                className={`${linkClass} flex cursor-pointer list-none items-center justify-between`}
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
  );
}

export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    seccion?: string;
    location?: string;
    aplica?: string;
  }>;
}) {
  const [{ lang, isAdmin }, params] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  const tab = parseConfigTab(params, isAdmin);
  // Only Conexiones opens the sales upload, and only when asked for.
  const uploadOpen =
    tab === "conexiones" &&
    (params.seccion === DATA_SETTINGS_SECTION_ANCHORS.connections ||
      params.tab === DATA_SETTINGS_SECTION_ANCHORS.connections);

  return (
    <div className="w-full max-w-3xl space-y-4 px-[26px] pb-10 pt-4">
      <div>
        <OperatingPageHeader
          title={t(lang, "Settings", "Configuración")}
          lang={lang}
          showDateRange={false}
        />
        <p className="mt-0.5 text-[13px] text-[#6b7385]">
          {subtitle(tab, lang)}
        </p>
      </div>

      <ConfigTabs active={tab} lang={lang} isAdmin={isAdmin} />

      {tab === "restaurante" ? (
        <RestaurantTab location={params.location} />
      ) : tab === "conexiones" ? (
        <LinkRows
          section="connections"
          isAdmin={isAdmin}
          lang={lang}
          uploadOpen={uploadOpen}
        />
      ) : tab === "objetivos" ? (
        <ObjetivosTab aplica={params.aplica} />
      ) : tab === "turnos" ? (
        <TurnosTab />
      ) : tab === "equipo" ? (
        <LinkRows section="team" isAdmin={isAdmin} lang={lang} />
      ) : (
        <LinkRows section="account" isAdmin={isAdmin} lang={lang} />
      )}
    </div>
  );
}
