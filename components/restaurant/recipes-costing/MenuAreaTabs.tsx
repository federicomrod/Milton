"use client";

// Menú's four real tabs (R1-09b, A3): each is a route under the shared
// menu/layout.tsx. 15 px labels, orange underline. Restaurant and period
// params ride along; per-tab params (producto, prep, estado) do not.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { withShellParams } from "@/lib/restaurant/navigation";
import {
  MENU_TAB_PATHS,
  type MenuTab,
} from "@/lib/restaurant/recetas-redirect";

const TABS: Array<{ id: MenuTab; en: string; es: string }> = [
  { id: "resumen", en: "Overview", es: "Resumen" },
  { id: "platos", en: "Dishes", es: "Platos" },
  { id: "preparaciones", en: "Preparations", es: "Preparaciones" },
  { id: "ingredientes", en: "Ingredients", es: "Ingredientes" },
];

export function activeMenuTab(pathname: string): MenuTab {
  for (const tab of ["platos", "preparaciones", "ingredientes"] as const) {
    const path = MENU_TAB_PATHS[tab];
    if (pathname === path || pathname.startsWith(path + "/")) return tab;
  }
  return "resumen";
}

export function MenuAreaTabs({ lang }: { lang: PreferredLanguage }) {
  const pathname = usePathname() ?? "";
  const searchParams = useSearchParams();
  const active = activeMenuTab(pathname);
  const shell = {
    locationId: searchParams.get("location"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  };
  return (
    <nav
      aria-label={t(lang, "Menu sections", "Secciones del menú")}
      className="mt-2 mb-4 flex gap-7 border-b border-[#dfe3ea]"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={withShellParams(MENU_TAB_PATHS[tab.id], shell)}
          aria-current={active === tab.id ? "page" : undefined}
          className={
            "-mb-px border-b-[3px] py-2 text-[15px] font-semibold " +
            (active === tab.id
              ? "border-[#f28c28] text-[#151c2c]"
              : "border-transparent text-[#6b7385] hover:text-[#151c2c]")
          }
        >
          {t(lang, tab.en, tab.es)}
        </Link>
      ))}
    </nav>
  );
}
