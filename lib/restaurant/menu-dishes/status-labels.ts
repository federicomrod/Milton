// lib/restaurant/menu-dishes/status-labels.ts
//
// The five dish statuses (and the two notes next to them) in the person's
// language. The ids stay Spanish; only the words change.

import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import type { DishStatus } from "@/lib/restaurant/costing/dish-status";

export function dishStatusLabel(
  status: string,
  lang: PreferredLanguage = "es"
): string {
  const s = getDictionary(lang).menu.screens.status;
  const known: Record<DishStatus, string> = {
    aprobado: s.aprobado,
    estimado: s.estimado,
    falta_precio: s.falta_precio,
    borrador: s.borrador,
    sin_receta: s.sin_receta,
  };
  return (known as Record<string, string>)[status] ?? status;
}

export function unconfirmedLinkLabel(lang: PreferredLanguage = "es"): string {
  return getDictionary(lang).menu.screens.status.unconfirmedLink;
}

export function fromMenuLabel(lang: PreferredLanguage = "es"): string {
  return getDictionary(lang).menu.screens.status.fromMenu;
}
