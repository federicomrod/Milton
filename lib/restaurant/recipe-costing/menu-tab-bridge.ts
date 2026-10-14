// lib/restaurant/recipe-costing/menu-tab-bridge.ts
//
// R1-12: lets the Menú tab bar (in the layout) hand a click to the open
// workspace, which switches tabs in the browser from its own cache instead
// of asking the server for a whole new page. When no workspace is open (the
// Ingredientes tab, a company without POS products, a first load) nothing
// is registered and the tab is an ordinary link.

import type { MenuTab } from "@/lib/restaurant/recetas-redirect";

export interface MenuTabSwitcher {
  /** Switch in the browser. False = not handled: follow the link. */
  switchTo(tab: MenuTab, href: string): boolean;
  /** Read the tab ahead of time (pointer over it, or keyboard focus). */
  prefetch(tab: MenuTab): void;
}

let current: MenuTabSwitcher | null = null;

export function registerMenuTabSwitcher(switcher: MenuTabSwitcher): () => void {
  current = switcher;
  return () => {
    if (current === switcher) current = null;
  };
}

export function trySwitchMenuTab(tab: MenuTab, href: string): boolean {
  return current ? current.switchTo(tab, href) : false;
}

export function prefetchMenuTab(tab: MenuTab): void {
  current?.prefetch(tab);
}
