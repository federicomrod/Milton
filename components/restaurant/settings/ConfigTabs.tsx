// Configuración's tabs: Restaurante · Conexiones · Objetivos · Turnos ·
// (Equipo, admins) · Cuenta. One page; the tab is in the URL (?tab=), so the
// back button and shared links work. Server-safe (plain links).

import Link from "next/link";
import {
  CONFIG_TABS,
  configTabHref,
  type ConfigTab,
} from "@/lib/restaurant/config-tabs";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { t } from "@/lib/restaurant/language";

export function configTabLabel(tab: ConfigTab, lang: PreferredLanguage) {
  switch (tab) {
    case "restaurante":
      return t(lang, "Restaurant", "Restaurante");
    case "conexiones":
      return t(lang, "Connections", "Conexiones");
    case "objetivos":
      return t(lang, "Goals", "Objetivos");
    case "turnos":
      return t(lang, "Shifts", "Turnos");
    case "equipo":
      return t(lang, "Team", "Equipo");
    case "cuenta":
      return t(lang, "Account", "Cuenta");
  }
}

export function ConfigTabs({
  active,
  lang,
  isAdmin,
}: {
  active: ConfigTab;
  lang: PreferredLanguage;
  isAdmin: boolean;
}) {
  return (
    <nav
      aria-label="Secciones de Configuración"
      className="inline-flex flex-wrap rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
    >
      {CONFIG_TABS.filter((tab) => tab !== "equipo" || isAdmin).map((tab) => (
        <Link
          key={tab}
          href={configTabHref(tab)}
          aria-current={active === tab ? "page" : undefined}
          className={
            "rounded-[9px] px-3.5 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] " +
            (active === tab
              ? "bg-[#1B40C8] text-white shadow-sm"
              : "text-[#4a5a85] hover:text-[#1B40C8]")
          }
        >
          {configTabLabel(tab, lang)}
        </Link>
      ))}
    </nav>
  );
}
