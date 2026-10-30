import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

/** Shown near the unresolved price choices and near «2. Importar recetas». */
export function pendingPriceChoicesNote(
  lang: PreferredLanguage = "es"
): string {
  return getDictionary(lang).menu.workspace.importPreview.pendingNote;
}

/** The Spanish text (default language). */
export const PENDING_PRICE_CHOICES_NOTE = pendingPriceChoicesNote("es");
