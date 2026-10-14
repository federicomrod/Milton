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
import {
  prefetchMenuTab,
  trySwitchMenuTab,
} from "@/lib/restaurant/recipe-costing/menu-tab-bridge";

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
      {TABS.map((tab) => {
        const href = withShellParams(MENU_TAB_PATHS[tab.id], shell);
        return (
          <Link
            key={tab.id}
            href={href}
            aria-current={active === tab.id ? "page" : undefined}
            // R1-12: an open workspace switches tabs from its own cache;
            // otherwise (or with a modifier key) this is a normal link.
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                active === tab.id
              ) {
                return;
              }
              if (trySwitchMenuTab(tab.id, href)) event.preventDefault();
            }}
            onMouseEnter={() => prefetchMenuTab(tab.id)}
            onFocus={() => prefetchMenuTab(tab.id)}
            className={
              "-mb-px border-b-[3px] py-2 text-[15px] font-semibold " +
              (active === tab.id
                ? "border-[#f28c28] text-[#151c2c]"
                : "border-transparent text-[#6b7385] hover:text-[#151c2c]")
            }
          >
            {t(lang, tab.en, tab.es)}
          </Link>
        );
      })}
    </nav>
  );
}
