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
import { getDictionary } from "@/lib/i18n";

export function configTabLabel(tab: ConfigTab, lang: PreferredLanguage) {
  const section = getDictionary(lang).shell.section;
  switch (tab) {
    case "restaurante":
      return section.restaurant;
    case "conexiones":
      return section.connections;
    case "objetivos":
      return section.objectives;
    case "turnos":
      return section.shifts;
    case "equipo":
      return section.team;
    case "cuenta":
      return section.account;
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
      aria-label={getDictionary(lang).settings.tabs.navLabel}
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
