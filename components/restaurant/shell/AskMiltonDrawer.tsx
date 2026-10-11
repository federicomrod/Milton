// components/restaurant/shell/AskMiltonDrawer.tsx
//
// Opens the EXISTING Ask Milton workspace as a right-hand overlay.
// Does not rebuild the assistant. Page context is passed as a short
// viewing hint when we know the current route; the chat API itself is
// unchanged (TODO: thread page context into /api/restaurant/ask-milton).

"use client";

import { usePathname } from "next/navigation";
import { MessageSquareText, X } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="ask-milton-drawer"
        data-page-context={pathname}
        className="fixed top-0 right-0 left-auto bottom-0 h-screen w-full max-w-[min(42rem,100vw)] translate-x-0 translate-y-0 rounded-none border-l p-0 gap-0 overflow-hidden flex flex-col sm:max-w-[min(42rem,100vw)]"
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border shrink-0">
          <div className="min-w-0">
            <DialogTitle className="text-base font-semibold">
              {t(lang, "Ask Milton", "Preguntar a Milton")}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              {pageLabel
                ? t(lang, `Viewing ${pageLabel}`, `Viendo ${pageLabel}`)
                : t(
                    lang,
                    "Ask about sales, menu, costs or the kitchen.",
                    "Pregúntale sobre ventas, menú, costos o la cocina."
                  )}
            </DialogDescription>
          </div>
          <DialogClose
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
            aria-label={t(lang, "Close", "Cerrar")}
          >
            <X className="h-4 w-4" />
          </DialogClose>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
          {/* TODO(#128): pass current page context into Ask Milton's API
              once the route accepts it. The drawer already records
              data-page-context and shows a viewing hint. */}
          <AskMiltonWorkspace />
        </div>
      </DialogContent>
    </Dialog>
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
      className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary text-primary-foreground h-10 px-4 text-sm font-semibold shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2"
    >
      <MessageSquareText className="h-4 w-4" />
      {t(lang, "Ask Milton", "Preguntar a Milton")}
    </button>
  );
}
