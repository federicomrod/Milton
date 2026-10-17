"use client";

// Menú's four real tabs (R1-09b, A3): each is a route under the shared
// menu/layout.tsx. 15 px labels, blue underline. Restaurant and period
// params ride along; per-tab params (producto, prep, estado) do not.

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { withShellParams } from "@/lib/restaurant/navigation";
import {
  MENU_TAB_PATHS,
  type MenuTab,
} from "@/lib/restaurant/recetas-redirect";
import { useSectionWarmth } from "@/components/restaurant/shell/use-section-warmth";
import { withSaveEpoch } from "@/lib/restaurant/save-epoch";
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
  // While the workspace is open, Resumen/Platos/Preparaciones switch from its
  // own copy and only Ingredientes (a page of its own) is prefetched in full.
  // From Ingredientes there is no workspace, so all four are pages to prefetch.
  const { epoch, warm } = useSectionWarmth();
  const shell = {
    locationId: searchParams.get("location"),
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  };
  return (
    <nav
      aria-label={t(lang, "Menu sections", "Secciones del menú")}
      className="mt-2 mb-2 flex gap-7 border-b border-[#dfe3ea]"
    >
      {TABS.map((tab) => {
        const isPage = tab.id === "ingredientes" || active === "ingredientes";
        const href = withSaveEpoch(
          withShellParams(MENU_TAB_PATHS[tab.id], shell),
          isPage ? epoch : 0
        );
        return (
          <Link
            key={tab.id}
            href={href}
            prefetch={isPage && warm ? true : undefined}
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
                ? "border-[#1b40c8] text-[#1b40c8]"
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
