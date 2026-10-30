import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

// Shared UI sentences. The constants stay Spanish (the default language) so
// existing imports keep working; the functions return the same sentence in
// the company's language (texts live in lib/i18n/*/cockpit.ts › uiCopy).

/** Shown instead of developer messages when a feature's table is missing in this environment. */
export const NOT_AVAILABLE_YET = "Esto aún no está disponible en tu cuenta.";

/** The link that sends the owner to the menu reader. */
export const READ_MENU_LABEL = "Leer tu menú →";

export const INGREDIENT_UNUSED =
  "Ninguna receta activa lo usa: no necesita precio.";
export const NEW_PRICE_KEEPS_HISTORY =
  "Se guarda un precio nuevo con fecha; el anterior no se borra.";
export const KITCHEN_TELEGRAM_INTRO =
  "Tu equipo escanea este código con Telegram y ya puede mandarte reportes y recetas por nota de voz.";
export const RECIPE_UPLOAD_INTRO =
  "Sube tus recetas en Excel, Word, PDF o foto. Milton prepara los borradores y tú los apruebas.";

const copy = (lang: PreferredLanguage) => getDictionary(lang).cockpit.uiCopy;

export const notAvailableYet = (lang: PreferredLanguage) =>
  copy(lang).notAvailableYet;
export const readMenuLabel = (lang: PreferredLanguage) => copy(lang).readMenu;
export const ingredientUnused = (lang: PreferredLanguage) =>
  copy(lang).ingredientUnused;
export const newPriceKeepsHistory = (lang: PreferredLanguage) =>
  copy(lang).newPriceKeepsHistory;
export const kitchenTelegramIntro = (lang: PreferredLanguage) =>
  copy(lang).kitchenTelegramIntro;
export const recipeUploadIntro = (lang: PreferredLanguage) =>
  copy(lang).recipeUploadIntro;
