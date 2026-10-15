"use client";

// R1-16a (mock 12): the four sections of Configuración as one segmented
// control: Conexiones · Objetivos · Turnos · Equipo · Cuenta. They are anchors
// of the settings page, except Objetivos and Turnos, which are screens of
// their own.

import Link from "next/link";
import {
  DATA_SETTINGS_HREF,
  DATA_SETTINGS_SECTION_ANCHORS,
  OBJECTIVES_HREF,
  SHIFTS_HREF,
  dataSettingsSectionLabel,
  type DataSettingsSectionId,
} from "@/lib/restaurant/navigation";
import type { PreferredLanguage } from "@/lib/restaurant/language";

const ORDER: DataSettingsSectionId[] = [
  "connections",
  "objectives",
  "shifts",
  "team",
  "account",
];

export function ConfigTabs({
  active,
  lang,
  isAdmin,
}: {
  active: DataSettingsSectionId;
  lang: PreferredLanguage;
  isAdmin: boolean;
}) {
  return (
    <nav
      aria-label="Secciones de Configuración"
      className="inline-flex rounded-[11px] bg-[#e1e8fa] p-[3px] text-[13px] font-semibold"
    >
      {ORDER.filter((s) => s !== "team" || isAdmin).map((section) => {
        const href =
          section === "objectives"
            ? OBJECTIVES_HREF
            : section === "shifts"
              ? SHIFTS_HREF
              : `${DATA_SETTINGS_HREF}?seccion=${DATA_SETTINGS_SECTION_ANCHORS[section]}#${DATA_SETTINGS_SECTION_ANCHORS[section]}`;
        return (
          <Link
            key={section}
            href={href}
            aria-current={active === section ? "page" : undefined}
            className={
              "rounded-[9px] px-3.5 py-1.5 " +
              (active === section
                ? "bg-[#1b40c8] text-white shadow-sm"
                : "text-[#4a5a85] hover:text-[#1b40c8]")
            }
          >
            {dataSettingsSectionLabel(section, lang)}
          </Link>
        );
      })}
    </nav>
  );
}
