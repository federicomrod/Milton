// lib/restaurant/user-error.ts
//
// Restaurant UI never shows a raw English server error. If the API body
// already carries one of our own localized messages (Spanish, German, or an
// English line from the dictionaries), keep it; otherwise use the call
// site's fallback. Callers pass the fallback in the language they show.

import { en } from "@/lib/i18n/en";

const SPANISH_MARK = /[áéíóúüñÁÉÍÓÚÜÑ¿¡]/;
const SPANISH_WORD =
  /\b(el|la|los|las|un|una|de|del|que|es|ya|hay|ese|esa|este|esta|estos|estas|debe|deben|tiene|tienen|tienes|faltan|falta|demasiados|demasiado|pud[eo]|pued[eoa]n?s?|factura[s]?|archivo[s]?|inténtalo|intenta|guardar|encontré|cuerpo|platos?|recetas?|sube|indica|elige|restaurante|líneas?|vacío|ingredientes?|proveedor(?:es)?|menú|costos?|permiso|cambiar|precios?|rol|familias?|unidades?|distintas?|esto|para|son|nada|actualizar|cantidades|mayores|formato|columnas|obligatorio|tratamiento|elementos|letras|turnos|grupo|existe|escribe|nombre|empresa|marca|lugar|anterior|igual|no se|no pude|no encontré)\b/i;
const GERMAN_MARK = /[äöüßÄÖÜ„“]/;
const GERMAN_WORD =
  /\b(Sie|Ihre[rnms]?|nicht|kein\w*|bitte|ungültig\w*|Rezepte?|Zutaten?|Rechnung(?:en)?|Lieferanten?|Gerichte?|Schichten?|Speisekarte|Unternehmen|erneut|Datei)\b/i;

function leaves(value: unknown, out: Set<string>): void {
  if (typeof value === "string") out.add(value);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) leaves(v, out);
  }
}

let knownEnglish: Set<string> | null = null;

/** Exact English API messages that come from our own dictionary. */
function isKnownEnglish(text: string): boolean {
  if (!knownEnglish) {
    knownEnglish = new Set();
    leaves(en, knownEnglish);
  }
  return knownEnglish.has(text);
}

function looksLocalized(text: string): boolean {
  return (
    SPANISH_MARK.test(text) ||
    SPANISH_WORD.test(text) ||
    GERMAN_MARK.test(text) ||
    GERMAN_WORD.test(text) ||
    isKnownEnglish(text)
  );
}

export function userErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "string") return fallback;
  const trimmed = error.trim();
  if (!trimmed) return fallback;
  return looksLocalized(trimmed) ? trimmed : fallback;
}
