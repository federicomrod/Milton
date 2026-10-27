// lib/restaurant/user-error.ts
//
// Restaurant UI never shows a raw English server error. If the API body
// already carries a clear Spanish `error` string, keep it; otherwise use
// the call site's Spanish fallback.

const SPANISH_MARK = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const SPANISH_WORD =
  /\b(pud[eo]|pued[eoa]n?s?|tienes?|factura[s]?|archivo[s]?|inténtalo|intenta|guardar|encontré|cuerpo|platos?|recetas?|sube|falta|indica|elige|restaurante|líneas?|vacío|ingredientes?|proveedor(?:es)?|menú|costos?|permiso|cambiar|precios?|rol|familias?|unidades?|distintas?|esto|para|son|no se|no pude|no encontré)\b/i;

function looksSpanish(text: string): boolean {
  return SPANISH_MARK.test(text) || SPANISH_WORD.test(text);
}

export function userErrorMessage(body: unknown, fallbackEs: string): string {
  if (!body || typeof body !== "object") return fallbackEs;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return fallbackEs;
  const trimmed = error.trim();
  if (!trimmed) return fallbackEs;
  return looksSpanish(trimmed) ? trimmed : fallbackEs;
}
