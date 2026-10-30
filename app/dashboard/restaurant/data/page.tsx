// app/dashboard/restaurant/data/page.tsx
//
// Configuración: ONE scrolling page, every section expanded, no tabs. A
// sticky index on the left (a chip row on phones) scrolls to a section; the
// old ?tab= / ?seccion= links and the old /data/* routes land on the matching
// section (ConfigIndex reads them). Each section shows its current values
// read-only and edits them in place.
//
//   ajustes · restaurantes · conexiones · objetivos · turnos · equipo · cuenta

import { Suspense } from "react";
import { OperatingPageHeader } from "@/components/restaurant/shell/OperatingPageHeader";
import { ConfigProvider } from "@/components/restaurant/config/ConfigProvider";
import { ConfigIndex } from "@/components/restaurant/config/ConfigIndex";
import { ConfigSection } from "@/components/restaurant/config/ConfigSection";
import { AjustesSection } from "@/components/restaurant/config/sections/AjustesSection";
import { RestaurantesSection } from "@/components/restaurant/config/sections/RestaurantesSection";
import { ConexionesSection } from "@/components/restaurant/config/sections/ConexionesSection";
import { ObjetivosSection } from "@/components/restaurant/config/sections/ObjetivosSection";
import { TurnosSection } from "@/components/restaurant/config/sections/TurnosSection";
import { EquipoSection } from "@/components/restaurant/config/sections/EquipoSection";
import { CuentaSection } from "@/components/restaurant/config/sections/CuentaSection";
import { SectionSkeleton } from "@/components/restaurant/config/SectionSkeleton";
import { I18nProvider } from "@/lib/i18n/client";
import { getDictionary } from "@/lib/i18n";
import { loadRestaurantShellChrome } from "@/lib/restaurant/shell-context-server";
import {
  CONFIG_SECTION_IDS,
  sectionForLegacyTab,
} from "@/lib/restaurant/config-sections";
import { DATA_SETTINGS_SECTION_ANCHORS } from "@/lib/restaurant/navigation";

export const dynamic = "force-dynamic";

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
  const [{ lang }, params] = await Promise.all([
    loadRestaurantShellChrome(),
    searchParams,
  ]);
  const s = getDictionary(lang).config.shared;
  // The sales-file panel opens when the old link asks for Conexiones.
  const uploadOpen =
    sectionForLegacyTab(params.tab ?? params.seccion) === "conexiones" &&
    (params.seccion === DATA_SETTINGS_SECTION_ANCHORS.connections ||
      params.tab === DATA_SETTINGS_SECTION_ANCHORS.connections);

  const body: Record<(typeof CONFIG_SECTION_IDS)[number], React.ReactNode> = {
    ajustes: <AjustesSection />,
    restaurantes: <RestaurantesSection location={params.location} />,
    conexiones: <ConexionesSection uploadOpen={uploadOpen} />,
    objetivos: <ObjetivosSection aplica={params.aplica} />,
    turnos: <TurnosSection />,
    equipo: <EquipoSection />,
    cuenta: <CuentaSection />,
  };

  return (
    <I18nProvider lang={lang}>
      <ConfigProvider>
        <div className="w-full px-[26px] pb-16 pt-4">
          <OperatingPageHeader
            title={s.title}
            lang={lang}
            showDateRange={false}
          />
          <div className="mt-4 lg:flex lg:gap-8">
            <ConfigIndex sections={[...CONFIG_SECTION_IDS]} />
            <div className="mt-4 min-w-0 max-w-[880px] flex-1 space-y-4 lg:mt-0">
              {CONFIG_SECTION_IDS.map((id) => (
                <ConfigSection key={id} id={id} title={s.nav[id]}>
                  <Suspense fallback={<SectionSkeleton />}>{body[id]}</Suspense>
                </ConfigSection>
              ))}
            </div>
          </div>
        </div>
      </ConfigProvider>
    </I18nProvider>
  );
}
