// components/restaurant/shell/AskMiltonDrawer.tsx
//
// Opens the EXISTING Ask Milton workspace as a right-hand overlay.
// Mounts once and hides so the conversation survives close/reopen.

"use client";

import { usePathname } from "next/navigation";
import { MessageSquareText, X } from "lucide-react";
import { AskMiltonWorkspace } from "@/components/restaurant/AskMiltonWorkspace";
import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import {
  COCKPIT_HREF,
  COSTS_HREF,
  DATA_SETTINGS_HREF,
  KITCHEN_HREF,
  MENU_HREF,
  SALES_HREF,
} from "@/lib/restaurant/navigation";

export function AskMiltonDrawer({
  open,
  onOpenChange,
  lang = "es",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang?: PreferredLanguage;
}) {
  const pathname = usePathname() ?? "";
  const pageLabel = pageContextLabel(pathname, lang);

  return (
    <div
      hidden={!open}
      className={open ? "fixed inset-0 z-50" : "hidden"}
      data-testid="ask-milton-drawer"
      data-page-context={pathname}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        aria-label={t(lang, "Close", "Cerrar")}
        onClick={() => onOpenChange(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="ask-milton-drawer-title"
        className="absolute top-0 right-0 bottom-0 w-full max-w-[min(42rem,100vw)] bg-background border-l border-border shadow-lg flex flex-col"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <h2
              id="ask-milton-drawer-title"
              className="text-base font-semibold"
            >
              {t(lang, "Ask Milton", "Preguntar a Milton")}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {pageLabel
                ? t(lang, `Viewing ${pageLabel}`, `Viendo ${pageLabel}`)
                : t(
                    lang,
                    "Ask about sales, menu, costs or the kitchen.",
                    "Pregúntale sobre ventas, menú, costos o la cocina."
                  )}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8]"
            aria-label={t(lang, "Close", "Cerrar")}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          <AskMiltonWorkspace lang={lang} />
        </div>
      </aside>
    </div>
  );
}

function pageContextLabel(
  pathname: string,
  lang: PreferredLanguage
): string | null {
  if (pathname === COCKPIT_HREF) return t(lang, "Cockpit", "Cockpit");
  if (pathname === SALES_HREF || pathname.startsWith(SALES_HREF + "/")) {
    return t(lang, "Sales", "Ventas");
  }
  if (pathname === MENU_HREF || pathname.startsWith(MENU_HREF + "/")) {
    return t(lang, "Menu", "Menú");
  }
  if (pathname === COSTS_HREF || pathname.startsWith(COSTS_HREF + "/")) {
    return t(lang, "Costs", "Costos");
  }
  if (pathname === KITCHEN_HREF || pathname.startsWith(KITCHEN_HREF + "/")) {
    return t(lang, "Kitchen", "Cocina");
  }
  if (
    pathname === DATA_SETTINGS_HREF ||
    pathname.startsWith(DATA_SETTINGS_HREF + "/")
  ) {
    return t(lang, "Data & Settings", "Datos y configuración");
  }
  return null;
}

export function AskMiltonButton({
  lang = "es",
  onClick,
}: {
  lang?: PreferredLanguage;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="ask-milton-button"
      onClick={onClick}
      className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground h-10 px-4 text-sm font-semibold shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B40C8] focus-visible:ring-offset-2"
    >
      <MessageSquareText className="h-4 w-4" />
      {t(lang, "Ask Milton", "Preguntar a Milton")}
    </button>
  );
}
