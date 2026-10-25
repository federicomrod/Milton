// lib/restaurant/price-update-note.ts
//
// Tiny, dependency-free so client components can import it.
// Notes of a supplier-invoice draft created from a price update sent by
// Telegram start with this text; Compras shows a neutral "Actualización de
// precio" label for those rows.

export const PRICE_UPDATE_NOTE_PREFIX =
  "Actualización de precio enviada por Telegram (de tu nota de voz / texto): revisa antes de aprobar.";

export function isPriceUpdateNote(notes: string | null | undefined): boolean {
  return (
    typeof notes === "string" && notes.startsWith(PRICE_UPDATE_NOTE_PREFIX)
  );
}
