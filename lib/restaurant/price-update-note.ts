// lib/restaurant/price-update-note.ts
//
// Tiny, dependency-free so client components can import it.
// Notes of a supplier-invoice draft created from a price update sent by
// Telegram start with this text; Compras shows a neutral "Actualización de
// precio" label for those rows.

export const PRICE_UPDATE_NOTE_PREFIX =
  "Actualización de precio enviada por Telegram (nota de voz o mensaje). Revísala antes de aprobar.";

/** The same, for a price update sent from the Cocina app (mobile). */
export const APP_PRICE_UPDATE_NOTE_PREFIX =
  "Actualización de precio enviada por la app (nota de voz o mensaje). Revísala antes de aprobar.";

/** The first wording, already saved on some staging drafts: still recognized. */
export const LEGACY_PRICE_UPDATE_NOTE_PREFIX =
  "Actualización de precio enviada por Telegram (de tu nota de voz / texto): revisa antes de aprobar.";

export function isPriceUpdateNote(notes: string | null | undefined): boolean {
  return (
    typeof notes === "string" &&
    (notes.startsWith(PRICE_UPDATE_NOTE_PREFIX) ||
      notes.startsWith(LEGACY_PRICE_UPDATE_NOTE_PREFIX) ||
      notes.startsWith(APP_PRICE_UPDATE_NOTE_PREFIX))
  );
}

/** First note of an invoice draft created from a photo sent by Telegram. */
export const INVOICE_TELEGRAM_NOTE =
  "Factura enviada por Telegram. Valores leídos de la foto: revisa antes de aprobar.";

/** True for a price update that came from the Cocina app: Compras says «por App». */
export function isAppInvoice(inv: { notes?: string | null }): boolean {
  return (inv.notes ?? "").startsWith(APP_PRICE_UPDATE_NOTE_PREFIX);
}

/**
 * True for a supplier invoice that came from Telegram (a photo or a price
 * update): the file name «telegram-…» or one of the two note prefixes. No
 * schema change; Compras shows a small «Telegram» label for these.
 */
export function isTelegramInvoice(inv: {
  original_file_name?: string | null;
  notes?: string | null;
}): boolean {
  const name = inv.original_file_name ?? "";
  const notes = inv.notes ?? "";
  if (isAppInvoice(inv)) return false;
  return (
    name.startsWith("telegram-") ||
    notes.startsWith(INVOICE_TELEGRAM_NOTE) ||
    isPriceUpdateNote(notes)
  );
}

/**
 * A supplier invoice row that is a real PURCHASE (not a Telegram price
 * update). A price update is a price, never a purchase: it must not count as
 * spend, a purchase line or an invoice in any total or count. A row with no
 * notes is a purchase. The server-side counterpart for cost entries lives in
 * lib/restaurant/price-update-refs.ts (`isPurchaseCostEntry`).
 */
export function isPurchaseInvoice(inv: { notes?: string | null }): boolean {
  return !isPriceUpdateNote(inv.notes);
}
