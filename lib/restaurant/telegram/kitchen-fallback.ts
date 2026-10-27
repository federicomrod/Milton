// lib/restaurant/telegram/kitchen-fallback.ts
//
// Deterministic replies for when the AI interpreter is unavailable (timeout,
// error) and wording helpers for stored stock reports. No AI, no I/O, and
// nothing here logs: the text is only ever used to pick a reply.
//
// The rule of the bot: never a bare «Recibido», never silence. When the AI
// cannot help, a greeting gets a greeting, a question gets "I can't answer
// questions yet", a price-looking message gets "I did not understand the price
// of X", a stock report gets the stock-report copy.

import {
  destinationVars,
  destinationWhere,
  KITCHEN_COPY,
  renderKitchenCopy,
} from "./kitchen-copy";
import {
  classifyKitchenReport,
  type KitchenReportType,
} from "./kitchen-reports";
import { hasPriceNumber, isPriceAiCandidate } from "./price-update";

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const GREETING_RE =
  /^(?:[¡!\s]*)(?:hola|holi|holis|ola|buen(?:os|as)?(?:\s+(?:dias?|tardes?|noches?))?|saludos|gracias|muchas gracias|mil gracias|adios|chao|hasta luego|nos vemos|ok|okay|vale|listo|perfecto|de nada)\b/;
const EMOJI_ONLY_RE = /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\s]+$/u;
const QUESTION_START_RE =
  /^(?:¿\s*)?(?:cuanto|cuanta|cuantos|cuantas|cual|cuales|que|como|donde|cuando|quien|quienes|por que|a cuanto|me puedes|puedes)\b/;

export function isQuestionText(text: string): boolean {
  if (/[?¿]/.test(text)) return true;
  return QUESTION_START_RE.test(fold(text));
}

export function isGreetingText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (EMOJI_ONLY_RE.test(t)) return true;
  return GREETING_RE.test(fold(t));
}

const STOP = new Set(
  (
    "el la los las un una unos unas de del al a en por para con sin y o que es esta estan son ya ahora hoy ayer " +
    "precio precios costo costos cuesta cuestan subio bajo sube baja vale valen sale salen lista " +
    "dolar dolares usd peso pesos mxn quetzal quetzales lempira lempiras sol soles euro euros colon colones cordoba cordobas " +
    "libra libras lb kilo kilos kg onza onzas oz unidad unidades litro litros caja cajas docena docenas " +
    "centavo centavos cada hola oye favor gracias nuevo nueva ultimo ultima"
  ).split(" ")
);

/**
 * The first plausible product words of a price-looking message («avocado 150»
 * -> «avocado»). Only used to say what was not understood; null = unknown.
 */
export function guessProductLabel(text: string): string | null {
  const words = fold(text)
    .replace(/[^a-zñ0-9$.,\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const run: string[] = [];
  for (const w of words) {
    const isWord = /^[a-zñ]{3,}$/.test(w) && !STOP.has(w);
    if (isWord) {
      run.push(w);
      if (run.length >= 3) break;
    } else if (run.length > 0) {
      break;
    }
  }
  return run.length > 0 ? run.join(" ") : null;
}

/** A number and a plausible product word, and not stock talk: «avocado 150». */
export function looksPriceLike(text: string): boolean {
  if (classifyKitchenReport(text) !== "unclassified") return false;
  if (!hasPriceNumber(text) || !isPriceAiCandidate(text)) return false;
  // A small whole number is a quantity («1 hamburguesa», «5 cajas»), not a price.
  const tokens = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return tokens.some((t) => /[.,]/.test(t) || Number(t) >= 20);
}

export function priceNotUnderstoodReply(text: string): string {
  return renderKitchenCopy(KITCHEN_COPY.PRICE_NOT_UNDERSTOOD, {
    productos: guessProductLabel(text) ?? "un precio",
  });
}

export function stockSection(type: KitchenReportType): string {
  return type === "waste" ? "Merma" : "Se agota";
}

/** «se agotó tomate», «merma de pollo», or the cook's own words (short) when no product is known. */
export function describeStock(
  type: KitchenReportType,
  products: string[],
  text: string
): string {
  const names = products.filter(Boolean);
  if (names.length > 0) {
    const list =
      names.length === 1
        ? names[0]
        : `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
    if (type === "waste") return `merma de ${list}`;
    if (type === "running_out") return `queda poco ${list}`;
    return `se agotó ${list}`;
  }
  const snippet = text.trim().replace(/\s+/g, " ").slice(0, 80);
  return snippet ? `«${snippet}»` : "tu aviso";
}

export function stockSavedReply(
  staff: Parameters<typeof destinationVars>[0],
  type: KitchenReportType,
  products: string[],
  text: string
): string {
  const kind: KitchenReportType =
    type === "unclassified" ? "running_out" : type;
  return renderKitchenCopy(KITCHEN_COPY.STOCK_REPORT_SAVED, {
    donde: destinationWhere(staff),
    detalle: describeStock(kind, products, text),
    seccion: stockSection(kind),
  });
}

/**
 * The reply when the AI gave us nothing. null = nothing sensible to say
 * (the caller then uses the generic «no pude procesarlo»).
 */
export function deterministicReply(
  text: string,
  staff: Parameters<typeof destinationVars>[0]
): string | null {
  const type = classifyKitchenReport(text);
  if (type !== "unclassified") return stockSavedReply(staff, type, [], text);
  if (looksPriceLike(text)) return priceNotUnderstoodReply(text);
  if (isQuestionText(text)) return KITCHEN_COPY.QUESTION_RESPONSE;
  if (isGreetingText(text)) {
    return renderKitchenCopy(
      KITCHEN_COPY.GREETING_RESPONSE,
      destinationVars(staff)
    );
  }
  return null;
}
