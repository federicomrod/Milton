/**
 * Pure, deterministic parser for ingredient price messages sent to the
 * kitchen bot («el aguacate subió a 1.50 la libra»).
 *
 * No LLM, no I/O: every number in the result is copied from the text, so it
 * cannot invent prices. When in doubt it answers `price_intent_unclear`.
 */

import { KITCHEN_COPY, renderKitchenCopy } from "./kitchen-copy";
import { currentKitchenLanguage } from "./kitchen-language";

export const PRICE_UPDATE_MAX_ITEMS = 25;
const MAX_PRICE = 100000;

export type Currency =
  | "USD"
  | "MXN"
  | "CRC"
  | "GTQ"
  | "HNL"
  | "PEN"
  | "EUR"
  | "NIO";

/** ISO code of a currency the parser can read (alias of `Currency`). */
export type PriceCurrency = Currency;

export type PriceUpdateItem = {
  name: string;
  price: number;
  unit: string;
  currency?: Currency | null;
};

export type PriceUpdateParse =
  | { kind: "price_update"; items: PriceUpdateItem[] }
  | { kind: "price_intent_unclear" }
  | null;

/** A price whose unit was not said («queso 3.25»): the bot asks once. */
export type UnitlessPrice = {
  name: string;
  price: number;
  /** ISO code; only present when the message named a currency. */
  currency?: string | null;
};

/**
 * A price whose ONLY problem is the 3-digit number without a currency
 * («aguacate a 150»: is it 1.50 or 150?). It is never saved by the parser:
 * the caller asks once. `options` = [amount / 100, amount].
 */
export type AmbiguousPrice = {
  product: string;
  options: [number, number];
  unit: string | null;
  currency: string | null;
  /** Internal (never shown or logged). */
  segment: string;
};

export type PriceMessageParse =
  | {
      kind: "price_update";
      items: PriceUpdateItem[];
      ambiguous?: AmbiguousPrice[];
    }
  | { kind: "needs_unit"; items: UnitlessPrice[]; ambiguous?: AmbiguousPrice[] }
  | {
      kind: "partial";
      items: PriceUpdateItem[];
      unitless: UnitlessPrice[];
      /** Segments that could not be read at all (ambiguous ones are NOT counted). */
      unclearCount: number;
      ambiguous?: AmbiguousPrice[];
    }
  | { kind: "price_intent_unclear"; ambiguous?: AmbiguousPrice[] }
  | null;

const ACCENTS: Record<string, string> = {
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ú: "u",
  ü: "u",
};

/** Same length as the input (so indices map back to the original text). */
function fold(s: string): string {
  return s.replace(/[áéíóúü]/g, (c) => ACCENTS[c] ?? c);
}

// Any price word, even without a number (-> unclear when nothing else matches).
const LOOSE_PRICE_WORD =
  /\b(subio|subieron|bajo|bajaron|sube|suben|baja|bajan|cuesta|cuestan|precio|precios|costo|cobran)\b/;
// Verb that makes a nearby number a price.
const PRICE_VERB = new RegExp(
  LOOSE_PRICE_WORD.source +
    "|\\b(?:vale|valen|sale|salen|quedo|paso|esta|estan)\\s+(?:a|en)\\s*(?=\\$?\\s*\\d)"
);
// Reports, recipes and stock talk: never a price unless a price verb is present.
const REPORT_WORD =
  /\b(receta|recetas|ingredientes?|llegaron|llego|quedan|queda|quedaron|sobran|sobraron|faltan|falta|se acabo|se acabaron|merma|desperdicio|porcion|porciones|86)\b/;

const UNIT =
  "(libras?|lbs?|kilogramos?|kilos?|kgs?|unidad(?:es)?|piezas?|pzas?|pzs?|pz|cajas?|docenas?|litros?|lts?|ltrs?|galon(?:es)?|botellas?|bolsas?|paquetes?|sacos?|atados?|manojos?|latas?|quintal(?:es)?|arrobas?|bandejas?|frascos?|gramos?|grs?|onzas?|onz[as]?|oz|g)(?![a-zñ])";

// Currency map (text AFTER the number, folded): regex pattern to ISO code.
// «pesos» means MXN by default (the pesos Milton companies use); a bare «$» is
// ambiguous (USD, MXN...) so it counts as "a currency was said" but carries no
// ISO code. «q» is never a word: only glued to the number (Q150), see
// prefixCurrency.
const CURRENCY_PATTERNS: Array<[RegExp, Currency]> = [
  [/^\s*(?:usd|us\$|dolar(?:es)?|dlls?|dls|\$)(?![a-zñ])/, "USD"],
  [/^\s*(?:pesos?|mxn|mx\$)(?![a-zñ])/, "MXN"],
  [/^\s*(?:colones?|₡|crc)(?![a-zñ])/, "CRC"],
  [/^\s*(?:quetzales?|gtq)(?![a-zñ])/, "GTQ"],
  [/^\s*(?:lempiras?|hnl)(?![a-zñ])/, "HNL"],
  [/^\s*(?:soles?|pen)(?![a-zñ])/, "PEN"],
  [/^\s*(?:euros?|eur|€)(?![a-zñ])/, "EUR"],
  [/^\s*(?:cordobas?|nio)(?![a-zñ])/, "NIO"],
];
const NUMBER_RE =
  /(\$\s*)?(?<![\d:/.,-])(\d+(?:[.,]\d+)*)(?!\d|[:/-]\d|[.,]\d)/g;

function canonicalUnit(foldedUnit: string, written: string): string {
  if (/^(libras?|lbs?)$/.test(foldedUnit)) return "lb";
  if (/^(kilogramos?|kilos?|kgs?)$/.test(foldedUnit)) return "kg";
  if (/^unidad(es)?$/.test(foldedUnit)) return "unidad";
  if (/^(pzas?|pzs?|pz)$/.test(foldedUnit)) return "pza";
  if (/^(onzas?|onz[as]?|oz)$/.test(foldedUnit)) return "oz";
  if (/^(gramos?|grs?|g)$/.test(foldedUnit)) return "g";
  if (/^(litros?|lts?|ltrs?)$/.test(foldedUnit)) return "litro";
  if (/^galon(es)?$/.test(foldedUnit)) return "galón";
  if (/^quintal(es)?$/.test(foldedUnit)) return "quintal";
  // «cajas» -> «caja»: the reply says «la caja».
  return written.length > 3 && written.endsWith("s")
    ? written.slice(0, -1)
    : written;
}

/**
 * Currency written right after a number. `code` is null for a bare «$» (a
 * currency was said, but which one is unknown). `len` = characters consumed.
 */
function currencySuffix(
  foldedRest: string
): { code: Currency | null; len: number } | null {
  for (const [pattern, code] of CURRENCY_PATTERNS) {
    const m = pattern.exec(foldedRest);
    if (m)
      return { code: /^\s*\$$/.test(m[0]) ? null : code, len: m[0].length };
  }
  return null;
}

/**
 * Currency symbol written right BEFORE a number: «mx$150», «₡150», «€150»,
 * «Q150» (the Q glued to the number, never a word). `symbol` is true for a
 * bare «$» too (code null).
 */
function prefixCurrency(
  folded: string,
  start: number,
  dollarPrefix: boolean
): { code: Currency | null; symbol: boolean; len: number } {
  const pre = folded.slice(0, start);
  if (dollarPrefix) {
    if (/\bmx$/.test(pre)) return { code: "MXN", symbol: true, len: 2 };
    if (/\bus$/.test(pre)) return { code: "USD", symbol: true, len: 2 };
    return { code: null, symbol: true, len: 0 };
  }
  const sym = /[₡€]\s?$/.exec(pre);
  if (sym) {
    return {
      code: sym[0].startsWith("₡") ? "CRC" : "EUR",
      symbol: true,
      len: sym[0].length,
    };
  }
  if (/(?<![a-zñ0-9])q$/.test(pre))
    return { code: "GTQ", symbol: true, len: 1 };
  return { code: null, symbol: false, len: 0 };
}

const CURRENCY_WORDS: Array<[RegExp, Currency]> = [
  [/(?<![a-zñ\d])(?:usd|us\$|dolar(?:es)?|dlls?|dls)(?![a-zñ])/, "USD"],
  [/(?<![a-zñ\d])(?:pesos?|mxn|mx\$)(?![a-zñ])/, "MXN"],
  [/(?<![a-zñ\d])(?:colones?|crc)(?![a-zñ])|₡/, "CRC"],
  [/(?<![a-zñ\d])(?:quetzales?|gtq)(?![a-zñ])|(?<![a-zñ\d])q(?=\d)/, "GTQ"],
  [/(?<![a-zñ\d])(?:lempiras?|hnl)(?![a-zñ])/, "HNL"],
  [/(?<![a-zñ\d])(?:soles|pen)(?![a-zñ])/, "PEN"],
  [/(?<![a-zñ\d])(?:euros?|eur)(?![a-zñ])|€/, "EUR"],
  [/(?<![a-zñ\d])(?:cordobas?|nio)(?![a-zñ])/, "NIO"],
];

/**
 * The first currency NAMED in a text (dólares, pesos, colones, Q150, €...),
 * as an ISO code. A bare «$» says nothing (null). Accent/case insensitive.
 * Note: «pesos» maps to MXN.
 */
export function currencyCodeFromText(text: string): Currency | null {
  if (typeof text !== "string") return null;
  const f = fold(text.toLowerCase());
  let best: { idx: number; code: Currency } | null = null;
  for (const [re, code] of CURRENCY_WORDS) {
    const m = re.exec(f);
    if (m && (best === null || m.index < best.idx)) {
      best = { idx: m.index, code };
    }
  }
  return best?.code ?? null;
}

/** A currency (word or symbol, including a bare «$») appears in the text. */
export function hasCurrencyMention(text: string): boolean {
  if (typeof text !== "string") return false;
  return currencyCodeFromText(text) !== null || /\$/.test(text);
}

const CURRENCY_NAMES: Record<Currency, string> = {
  USD: "dólares",
  MXN: "pesos",
  CRC: "colones",
  GTQ: "quetzales",
  HNL: "lempiras",
  PEN: "soles",
  EUR: "euros",
  NIO: "córdobas",
};

/** «dólares», «pesos», «colones»…: how a person names the currency. */
export function currencyNameFor(code: string | null | undefined): string {
  return (code && CURRENCY_NAMES[code as Currency]) || (code ?? "");
}

// ---------------------------------------------------------------------------
// Spoken prices (voice transcripts): «un dólar cincuenta», «dos dólares con
// veinticinco», «un dólar y medio» -> «1.50 dólares». Tight and deterministic.
// ---------------------------------------------------------------------------

const WORD_VALUES: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciséis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiún: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintidós: 22,
  veintitres: 23,
  veintitrés: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintiséis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  noventa: 90,
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};
const ONES_W = "uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve";
const TENS_W = "treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa";
const HUNDREDS_W =
  "(?:cien(?:to)?|doscientos?|doscientas?|trescientos?|trescientas?|cuatrocientos?|cuatrocientas?|quinientos?|quinientas?|seiscientos?|seiscientas?|setecientos?|setecientas?|ochocientos?|ochocientas?|novecientos?|novecientas?)";
const UP_TO_29 = Object.keys(WORD_VALUES)
  .filter((w) => WORD_VALUES[w] < 30)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM_WORD = `(?:(?:${HUNDREDS_W})(?:\\s+(?:${TENS_W})(?:\\s+y\\s+(?:${ONES_W}))?|\\s+(?:${UP_TO_29}))?|(?:${TENS_W})(?:\\s+y\\s+(?:${ONES_W}))?|${UP_TO_29})`;
// Dollars: a number word or up to 4 digits (never the «1» of «1.50»).
const NUM_ANY = `(?:${NUM_WORD}|\\d{1,4}(?![.,]\\d))`;
const CENT_ANY = `(?:${NUM_WORD}|\\d{1,2})`;
const NOT_WORD_BEFORE = "(?<![a-zñáéíóúü\\d.,$])";
const SPOKEN_DOLLARS = new RegExp(
  `${NOT_WORD_BEFORE}(${NUM_ANY})\\s+d[oó]lar(?:es)?(?:\\s+(?:(con|y)\\s+(medio|${CENT_ANY})|(${CENT_ANY}))(?:\\s+centavos?)?(?![a-zñáéíóúü\\d]))?`,
  "g"
);
const HALF_DOLLAR =
  /(?<![a-zñáéíóúü\d])medio\s+d[oó]lar(?:es)?(?![a-zñáéíóúü])/g;
// «dólar cincuenta» (nothing before «dólar»): one dollar and the cents.
const BARE_DOLLAR = new RegExp(
  `(?<![a-zñáéíóúü\\d])d[oó]lar\\s+(${NUM_WORD})(?:\\s+centavos?)?(?![a-zñáéíóúü\\d])`,
  "g"
);
const CENTAVOS = new RegExp(
  `${NOT_WORD_BEFORE}(${CENT_ANY})\\s+centavos?(?![a-zñáéíóúü])`,
  "g"
);
// «uno cincuenta», «tres con cincuenta», «1 con 50»: dollars then cents.
const PRICE_PAIR = new RegExp(
  `${NOT_WORD_BEFORE}(${NUM_WORD}|\\d{1,2})(\\s+(?:con|y)\\s+|\\s+)(${NUM_WORD}|\\d{2})(?![a-zñáéíóúü\\d])(?![.,]\\d)`,
  "g"
);
const HUNDREDS_AMOUNT = new RegExp(
  `${NOT_WORD_BEFORE}(${HUNDREDS_W}(?:\\s+(?:${TENS_W})(?:\\s+y\\s+(?:${ONES_W}))?|\\s+(?:${UP_TO_29}))?)(?![a-zñáéíóúü\\d])`,
  "g"
);
const LONE_AFTER_A = new RegExp(
  `(?<![a-zñáéíóúü])((?:a|en)\\s+)(${NUM_WORD})(?![a-zñáéíóúü])`,
  "g"
);
const PAREN_UNIT = new RegExp(
  "\\(\\s*((?:(?:por|la|el|x|a la|al)\\s+|\\/\\s*)?" + UNIT + ")\\s*\\)",
  "g"
);
// After a number: a currency / «centavos» / «c/u», or «la|el|por|x|/ + unit».
const STRONG_SUFFIX = new RegExp(
  "^\\s*(?:(?:dolar|dolares|usd|dlls?|dls|centavos?|pesos?|mxn|colones?|crc|quetzales?|gtq|lempiras?|hnl|soles|pen|euros?|eur|cordobas?|nio)(?![a-zñ])|[$€₡]|c\\/u|cada\\s+un[oa]\\b|(?:\\/\\s*|(?:por|la|el|x)\\s+)" +
    UNIT +
    ")"
);
const UNIT_MARK_SUFFIX = new RegExp(
  "^\\s*(?:\\/\\s*|(?:por|la|el|x)\\s+)" + UNIT
);

function wordsToNumber(words: string): number | null {
  const parts = words.trim().split(/\s+/);
  if (parts.length === 1) return WORD_VALUES[parts[0]] ?? null;
  if (parts.length === 3 && parts[1] === "y") {
    const t = WORD_VALUES[parts[0]];
    const u = WORD_VALUES[parts[2]];
    return t !== undefined && u !== undefined ? t + u : null;
  }
  // Handle hundreds: "ciento cincuenta" = 150, "doscientos treinta y cinco" = 235
  let total = 0;
  let i = 0;
  const h = WORD_VALUES[parts[i]];
  if (h !== undefined && h >= 100) {
    total = h;
    i++;
  }
  if (i < parts.length) {
    const t = WORD_VALUES[parts[i]];
    if (t !== undefined && t >= 10 && t < 100) {
      total += t;
      i++;
    }
  }
  if (i + 1 < parts.length && parts[i] === "y") {
    const u = WORD_VALUES[parts[i + 1]];
    if (u !== undefined && u < 10) {
      total += u;
      i += 2;
    }
  }
  return i > 0 && i === parts.length ? total : null;
}

function tokenValue(token: string): number | null {
  return /^\d+$/.test(token) ? Number(token) : wordsToNumber(token);
}

function replaceAll(
  str: string,
  re: RegExp,
  fn: (m: RegExpMatchArray, start: number, end: number) => string | null
): string {
  let out = "";
  let last = 0;
  for (const m of str.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const rep = fn(m, start, end);
    if (rep === null) continue;
    out += str.slice(last, start) + rep;
    last = end;
  }
  return out + str.slice(last);
}

/** «strong»: currency / unit marker follows. «weak»: end or punctuation. */
function suffixKind(rest: string): "strong" | "weak" | null {
  const f = fold(rest);
  if (STRONG_SUFFIX.test(f)) return "strong";
  if (/^\s*(?:$|[.,;:!?)]|y\b|pero\b)/.test(f)) return "weak";
  return null;
}

/** A product word comes before, and (for a weak suffix) «a/en/cuesta/vale…». */
function pricePrefixOk(prefix: string, kind: "strong" | "weak"): boolean {
  const sentence =
    fold(prefix)
      .trimEnd()
      .split(/[.!?;]/)
      .pop() ?? "";
  if (!/[a-zñ]/.test(sentence)) return false;
  if (kind === "strong") return true;
  return /(?:\b(?:a|en|cuesta|cuestan|vale|valen|sale|salen)|[,:])\s*$/.test(
    sentence
  );
}

function stripUnitParens(s: string): string {
  let out = "";
  let last = 0;
  for (const m of fold(s).matchAll(PAREN_UNIT)) {
    const i = m.index ?? 0;
    out +=
      s.slice(last, i) + " " + s.slice(i + 1, i + m[0].length - 1).trim() + " ";
    last = i + m[0].length;
  }
  return out + s.slice(last);
}

/**
 * Lowercase text in, the same text with spoken amounts as digits. Only
 * numbers in PRICE POSITION change: «un dólar cincuenta», «dólar cincuenta»,
 * «75 centavos», «a uno cincuenta la libra», «aguacate, uno con cincuenta»,
 * «a 1 con 50». Quantities («dos libras de masa», «6 tomates») never do.
 * «un dólar cinco» stays as it is: never guess.
 */
export function normalizeSpokenPrices(lower: string): string {
  let s = stripUnitParens(lower).replace(/\s+/g, " ");
  s = s.replace(HALF_DOLLAR, "0.50 dólares");
  s = replaceAll(s, SPOKEN_DOLLARS, (m, _start, end) => {
    const [, dollars, , withConnector, bare] = m;
    const d = tokenValue(dollars);
    if (d === null) return null;
    const cents = withConnector ?? bare;
    if (!cents) return `${d} dólares`;
    const v = cents === "medio" ? 50 : tokenValue(cents);
    if (v === null || v >= 100) return null;
    // «un dólar cinco» is not 1.05: a bare number needs 10 or more cents.
    if (bare) {
      if (v < 10) return null;
      if (suffixKind(s.slice(end)) === null) return null;
    }
    return `${(d + v / 100).toFixed(2)} dólares`;
  });
  s = replaceAll(s, BARE_DOLLAR, (m, _start, end) => {
    const v = wordsToNumber(m[1]);
    if (v === null || v < 10 || v >= 100) return null;
    if (suffixKind(s.slice(end)) === null) return null;
    return `${(1 + v / 100).toFixed(2)} dólares`;
  });
  s = replaceAll(s, CENTAVOS, (m) => {
    const v = tokenValue(m[1]);
    if (v === null || v < 1 || v > 99) return null;
    return `${(v / 100).toFixed(2)} dólares`;
  });
  // «aguacate a ciento cincuenta», «doscientos pesos la libra»: a spoken
  // hundreds amount in price position -> digits. Before PRICE_PAIR so
  // «ciento cincuenta» is never read as 100 + 50 cents.
  s = replaceAll(s, HUNDREDS_AMOUNT, (m, start, end) => {
    const v = wordsToNumber(m[1]);
    if (v === null || v < 100) return null;
    const kind = suffixKind(s.slice(end));
    if (!kind || !pricePrefixOk(s.slice(0, start), kind)) return null;
    return String(v);
  });
  s = replaceAll(s, PRICE_PAIR, (m, start, end) => {
    const [, a, connector, b] = m;
    const digits = /^\d/.test(a) || /^\d/.test(b);
    if (digits && !/(?:con|y)/.test(connector)) return null;
    const dollars = tokenValue(a);
    const cents = tokenValue(b);
    if (dollars === null || cents === null) return null;
    if (dollars < 1 || cents < 10 || cents > 99) return null;
    const kind = suffixKind(s.slice(end));
    if (!kind || !pricePrefixOk(s.slice(0, start), kind)) return null;
    return (dollars + cents / 100).toFixed(2);
  });
  s = replaceAll(s, LONE_AFTER_A, (m, _start, end) => {
    if (!UNIT_MARK_SUFFIX.test(fold(s.slice(end)))) return null;
    const v = wordsToNumber(m[2]);
    return v === null ? null : `${m[1]}${v}`;
  });
  return s;
}

/** Returns the number, or null when ambiguous / out of range. */
function parseNumber(token: string): number | null {
  let v: number;
  if (/^\d+$/.test(token)) v = Number(token);
  else if (/^\d+[.,]\d{1,2}$/.test(token)) v = Number(token.replace(",", "."));
  else return null; // "1,500", "1.500", "1.234,56": never guess
  if (!Number.isFinite(v) || v <= 0 || v > MAX_PRICE) return null;
  return v;
}

function cleanName(
  folded: string,
  original: string,
  start: number,
  end: number
): string | null {
  let lo = start;
  let hi = end;
  const left = (re: RegExp) => {
    const m = re.exec(folded.slice(lo, hi));
    if (m) lo += m[0].length;
  };
  const right = (re: RegExp) => {
    const m = re.exec(folded.slice(lo, hi));
    if (m) hi = lo + m.index;
  };
  left(/^\s+/);
  for (let i = 0; i < 3; i++) {
    left(/^(?:hola|oye|ojo|hoy|ahora|ya|que)\b\s*,?\s*/);
  }
  left(
    /^(?:el\s+)?(?:(?:ultimo|nuevo|actual)\s+)?precios?\s+de(?:l|\s+(?:el|la|los|las))?\s+/
  );
  left(/^(?:el|la|los|las|un|una)\s+/);
  for (let i = 0; i < 3; i++) {
    right(
      /\s*(?:\b(?:ahora|hoy)\s+)?\b(?:subio|bajo|cuesta|esta|quedo|paso|sube|baja|vale|sale|cuestan|estan|subieron|bajaron|ahora|es|son|anda|andan|ya)\s*(?:ahora\s*)?(?:(?:a|en|de|por)\s*)?$/
    );
    right(/\s*\b(?:a|en|de|por|del)\s*:?$/);
    right(/\s*:$/);
    right(/\s*[([¿¡"«]+$/);
  }
  const name = original.slice(lo, hi).trim();
  if (!name) return null;
  if (name.length > 40 || name.split(" ").length > 4) return null;
  if (!/^[a-zñáéíóúü]+(?: [a-zñáéíóúü]+)*$/.test(name)) return null;
  // «dos libras de masa» is a quantity, not a product.
  const words = fold(name).split(" ");
  if (WORD_VALUES[words[0]] !== undefined) return null;
  if (words.some((w) => new RegExp("^" + UNIT + "$").test(w))) return null;
  return name;
}

type SegmentResult =
  | { state: "item"; item: PriceUpdateItem }
  | { state: "unitless"; item: UnitlessPrice }
  | {
      state: "unclear";
      label: string | null;
      hint?: string;
      /** Unit said next to an ambiguous number («aguacate a 150 la libra»). */
      unit?: string | null;
    }
  | { state: "none" };

type Candidate =
  | { ok: true; price: number; unit: string; currency: Currency | null }
  | {
      ok: false;
      unitless?: number;
      ambiguous?: string;
      unit?: string | null;
      currency?: Currency | null;
    };

/**
 * «150», «125», «350» without a decimal point or a currency: it may be 1.50,
 * 1.25, 3.50 said fast. Never converted and never saved as 150.
 */
export function looksLikeCents(token: string): boolean {
  return /^[1-9]\d{2}$/.test(token) && token.slice(1) !== "00";
}

function parseSegment(folded: string, original: string): SegmentResult {
  const hasVerb = PRICE_VERB.test(folded);
  const matches = [...folded.matchAll(NUMBER_RE)];
  const hasLoose =
    LOOSE_PRICE_WORD.test(folded) ||
    /\$|dolar|usd/.test(folded) ||
    currencyCodeFromText(folded) !== null;
  if (matches.length === 0) {
    return hasLoose ? { state: "unclear", label: null } : { state: "none" };
  }

  const first = matches[0];
  // The name stops before a glued currency symbol («aguacate Q150»).
  const nameEnd =
    (first.index ?? 0) -
    prefixCurrency(folded, first.index ?? 0, !!first[1]).len;
  const candidates: Candidate[] = [];

  for (const m of matches) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const dollarPrefix = !!m[1];
    let pos = end;
    const rest = folded.slice(pos);

    const suffix = currencySuffix(rest);
    const prefix = prefixCurrency(folded, start, dollarPrefix);
    // Explicit = a currency word/symbol was written (even a bare «$»).
    const currency = suffix !== null || prefix.symbol;
    const currencyCode: Currency | null = suffix ? suffix.code : prefix.code;
    if (suffix) pos += suffix.len;
    // Nothing after the price (and its currency): «queso 3.25», «aguacate $1.50».
    const atEnd = /^[\s.!?)]*$/.test(folded.slice(pos));

    let marker = false;
    let unit: string | null = null;
    const cu = /^\s*(?:c\/u|cada\s+un[oa])(?![a-z])/.exec(folded.slice(pos));
    if (cu) {
      marker = true;
      unit = "unidad";
    } else {
      const mk = /^\s*(?:(?:\/|por|la|el|cada)\s*|x\s+)/.exec(
        folded.slice(pos)
      );
      if (mk) {
        marker = true;
        pos += mk[0].length;
      } else {
        const sp = /^\s+/.exec(folded.slice(pos));
        if (sp) pos += sp[0].length;
      }
      const um = new RegExp("^" + UNIT).exec(folded.slice(pos));
      if (um)
        unit = canonicalUnit(um[1], original.slice(pos, pos + um[1].length));
    }

    // A decimal price with nothing after it («queso 3.25») is a price whose
    // unit is missing; a bare integer or a quantity with a unit never is.
    const bareDecimal = unit === null && atEnd && /[.,]\d{1,2}$/.test(m[2]);
    const ambigAtEnd =
      unit === null &&
      atEnd &&
      looksLikeCents(m[2]) &&
      /\b(?:a|en)\s*\$?\s*$/.test(folded.slice(0, start));
    const relevant =
      hasVerb ||
      dollarPrefix ||
      currency ||
      (marker && unit !== null) ||
      bareDecimal ||
      ambigAtEnd;
    if (!relevant) continue;

    if (!dollarPrefix && !currency && looksLikeCents(m[2])) {
      candidates.push({ ok: false, ambiguous: m[2], unit });
      continue;
    }
    const price = parseNumber(m[2]);
    if (price === null) candidates.push({ ok: false });
    else if (unit === null) {
      candidates.push(
        atEnd
          ? { ok: false, unitless: price, currency: currencyCode }
          : { ok: false }
      );
    } else candidates.push({ ok: true, price, unit, currency: currencyCode });
  }

  const label = cleanName(folded, original, 0, nameEnd);
  if (candidates.length === 0) {
    return hasLoose ? { state: "unclear", label } : { state: "none" };
  }
  if (candidates.length > 1 && candidates.filter((c) => c.ok).length !== 1) {
    return { state: "unclear", label };
  }
  const good = candidates.filter((c) => c.ok);
  const pick = good.length === 1 ? good[0] : candidates[0];
  if (!pick.ok) {
    if (candidates.length === 1 && pick.unitless !== undefined) {
      if (!label) return { state: "unclear", label };
      const item: UnitlessPrice = { name: label, price: pick.unitless };
      if (pick.currency) item.currency = pick.currency;
      return { state: "unitless", item };
    }
    if (candidates.length === 1 && pick.ambiguous !== undefined) {
      return {
        state: "unclear",
        label,
        hint: pick.ambiguous,
        unit: pick.unit ?? null,
      };
    }
    return { state: "unclear", label };
  }
  // More than one fully valid price in one segment: ambiguous.
  if (candidates.length > 1 && candidates.some((c) => !c.ok) && !hasVerb) {
    return { state: "unclear", label };
  }

  const name = label;
  if (!name) return { state: "unclear", label };
  const item: PriceUpdateItem = {
    name,
    price: pick.price,
    unit: pick.unit,
  };
  if (pick.currency) item.currency = pick.currency;
  return { state: "item", item };
}

function prepare(text: string): { original: string; folded: string } | null {
  if (typeof text !== "string") return null;
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return null;
  const original = normalizeSpokenPrices(lower);
  return { original, folded: fold(original) };
}

/** A segment that could not be read; `segment` is internal (never shown or logged). */
export type UnclearSegment = {
  label: string | null;
  /** «150»: it may be 1.50 or 150. */
  hint?: string;
  segment: string;
};

/** Everything the rules read in one message, item by item. */
export type ItemParse = {
  items: PriceUpdateItem[];
  unitless: UnitlessPrice[];
  unclear: UnclearSegment[];
  /**
   * Prices whose only problem is a 3-digit number without a currency. They
   * are ALSO listed in `unclear` (with `hint`) for older callers.
   */
  ambiguous: AmbiguousPrice[];
  /** Products said to have no price («el agua tibia no tiene precio»). */
  skippedNoPrice: string[];
  /** A price word / currency was there, even if nothing could be read. */
  priceIntent: boolean;
};

const NO_PRICE_PHRASE =
  /\b(?:no\s+(?:tiene|tienen|hay|tengo|se)\s+(?:el\s+|un\s+)?(?:precio|costo|valor)|sin\s+(?:precio|costo)|no\s+(?:tiene|tienen)\s+valor)\b/;
const VERB_ONLY =
  /\b(?:subio|subieron|bajo|bajaron|sube|suben|baja|bajan|cuesta|cuestan|cobran)\b/;
const INTRO_WORD = /\b(?:precios?|costos?|lista)\b/;
const NUMBER_START = /^(?:(?:a|en|esta a|cuesta|vale|sale)\s+)?\$?\d/;
const SEPARATOR = /\s+y\s+|,\s+|;\s*|:\s+|\.\s+(?=\S)/g;

function splitSegments(
  folded: string,
  original: string
): Array<[string, string]> {
  const raw: Array<[string, string]> = [];
  let last = 0;
  for (const m of folded.matchAll(SEPARATOR)) {
    const i = m.index ?? 0;
    raw.push([folded.slice(last, i), original.slice(last, i)]);
    last = i + m[0].length;
  }
  raw.push([folded.slice(last), original.slice(last)]);

  // «Aguacate, uno con cincuenta la libra»: a product alone, then its price.
  const merged: Array<[string, string]> = [];
  for (const seg of raw) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      !/\d/.test(prev[0]) &&
      /[a-zñ]/.test(prev[0]) &&
      prev[0].trim().split(" ").length <= 4 &&
      NUMBER_START.test(seg[0].trim())
    ) {
      merged[merged.length - 1] = [
        `${prev[0]} ${seg[0]}`,
        `${prev[1]} ${seg[1]}`,
      ];
    } else if (seg[0].trim()) {
      merged.push(seg);
    }
  }

  // Two items run together without punctuation: cut after a finished
  // «la libra» when another product and number follow.
  const out: Array<[string, string]> = [];
  const unitEnd = new RegExp("(?:\\/\\s*|\\b(?:por|la|el|x)\\s+)" + UNIT, "g");
  for (const [f, o] of merged) {
    let from = 0;
    for (const m of f.matchAll(unitEnd)) {
      const end = (m.index ?? 0) + m[0].length;
      const rest = f.slice(end);
      if (/^\s+[a-zñ]/.test(rest) && /\d/.test(rest)) {
        out.push([f.slice(from, end), o.slice(from, end)]);
        from = end;
      }
    }
    out.push([f.slice(from), o.slice(from)]);
  }
  return out.filter(([f]) => f.trim().length > 0);
}

/**
 * Item by item: every segment of the message is read on its own. One that
 * cannot be read is reported, it never blocks the others.
 */
export function parsePriceItems(text: string): ItemParse | null {
  const p = prepare(text);
  if (!p) return null;
  const out: ItemParse = {
    items: [],
    unitless: [],
    unclear: [],
    ambiguous: [],
    skippedNoPrice: [],
    priceIntent: false,
  };
  for (const [f, o] of splitSegments(p.folded, p.original)) {
    // Stock / recipe talk is never a price (unless a price word is there).
    if (REPORT_WORD.test(f) && !LOOSE_PRICE_WORD.test(f)) continue;

    const noPrice = NO_PRICE_PHRASE.exec(f);
    if (noPrice) {
      const name = cleanName(f, o, 0, noPrice.index);
      out.skippedNoPrice.push(name ?? "");
      continue;
    }

    if (!/\d/.test(f)) {
      const verb = VERB_ONLY.exec(f);
      // «¿cuánto cuesta la pupusa?» is a question, not a malformed price.
      if (verb && /[¿?]/.test(o)) continue;
      if (verb) {
        out.priceIntent = true;
        const label = cleanName(f, o, 0, verb.index);
        if (label) out.unclear.push({ label, segment: f });
      } else if (INTRO_WORD.test(f)) {
        out.priceIntent = true; // «precios para las pupusas»: an intro
      } else if (/\$|dolar|usd|centavo/.test(f)) {
        out.priceIntent = true;
        out.unclear.push({ label: null, segment: f });
      }
      continue;
    }

    let r = parseSegment(f, o);
    // Not readable by the rules, yet it reads like a price («masa (0,75) la libra»).
    if (r.state === "none" && looksLikePriceIntent(o)) {
      const nameEnd = f.match(NUMBER_RE) ? f.search(/\d/) : f.length;
      r = { state: "unclear", label: cleanName(f, o, 0, nameEnd) };
    }
    if (r.state === "none") continue;
    out.priceIntent = true;
    if (r.state === "item") out.items.push(r.item);
    else if (r.state === "unitless") out.unitless.push(r.item);
    else {
      out.unclear.push({ label: r.label, hint: r.hint, segment: f });
      if (r.hint !== undefined && r.label) {
        const amount = Number(r.hint);
        out.ambiguous.push({
          product: r.label,
          options: [Math.round(amount) / 100, amount],
          unit: r.unit ?? null,
          currency: null,
          segment: f,
        });
      }
    }
  }
  if (
    out.items.length + out.unitless.length + out.unclear.length === 0 &&
    out.skippedNoPrice.length === 0 &&
    out.priceIntent
  ) {
    // «cuánto es el precio del aguacate?»: a price was meant, none was said.
    out.unclear.push({ label: null, segment: "" });
  }
  return out;
}

/** Items with a unit, or «unclear». A price without a unit is «unclear» here. */
export function parsePriceUpdate(text: string): PriceUpdateParse {
  const r = parsePriceItems(text);
  if (!r) return null;
  if (r.unclear.length > 0 || r.unitless.length > 0) {
    return { kind: "price_intent_unclear" };
  }
  if (r.items.length > 0) {
    return {
      kind: "price_update",
      items: r.items.slice(0, PRICE_UPDATE_MAX_ITEMS),
    };
  }
  return null;
}

/**
 * Like parsePriceUpdate, but a price without a unit comes back as
 * `needs_unit` so the bot can ask once. A message that is part readable,
 * part not («tomate 0.80 la libra y cebolla $0.45») is `partial`: what was
 * read is kept, the rest is reported (the pipeline never drops it all).
 */
export function parsePriceMessage(text: string): PriceMessageParse {
  const r = parsePriceItems(text);
  if (!r) return null;
  const amb = r.ambiguous.length > 0 ? { ambiguous: r.ambiguous } : {};
  // Ambiguous segments are reported in `ambiguous`, not as unreadable.
  const unclearCount = r.unclear.length - r.ambiguous.length;
  const read = r.items.length + r.unitless.length;
  if (read === 0) {
    return r.unclear.length > 0
      ? { kind: "price_intent_unclear", ...amb }
      : null;
  }
  if (unclearCount > 0 || (r.items.length > 0 && r.unitless.length > 0)) {
    return {
      kind: "partial",
      items: r.items.slice(0, PRICE_UPDATE_MAX_ITEMS),
      unitless: r.unitless.slice(0, PRICE_UPDATE_MAX_ITEMS),
      unclearCount,
      ...amb,
    };
  }
  if (r.unitless.length > 0) {
    return {
      kind: "needs_unit",
      items: r.unitless.slice(0, PRICE_UPDATE_MAX_ITEMS),
      ...amb,
    };
  }
  return {
    kind: "price_update",
    items: r.items.slice(0, PRICE_UPDATE_MAX_ITEMS),
    ...amb,
  };
}

/**
 * A fragment the AI says the price came from: does it have the shape of a
 * price (currency, «centavos», a decimal, or a per-unit marker)? Quantities
 * («6 tomates», «2 libras de masa») do not.
 */
export function hasPriceShape(fragment: string): boolean {
  const f = fold(fragment.toLowerCase());
  if (/\$|\bdolar(?:es)?\b|\busd\b|\bcentavos?\b/.test(f)) return true;
  if (currencyCodeFromText(f) !== null) return true;
  for (const m of f.matchAll(NUMBER_RE)) {
    if (/[.,]\d{1,2}$/.test(m[2])) return true;
    const after = f.slice((m.index ?? 0) + m[0].length);
    if (/^\s*(?:c\/u|cada\s+un[oa])(?![a-z])/.test(after)) return true;
    if (UNIT_MARK_SUFFIX.test(after)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Signals for the pipeline (is there a number? does it look like a price?)
// ---------------------------------------------------------------------------

function plainNumbers(folded: string): string[] {
  return [...folded.matchAll(NUMBER_RE)].map((m) => m[2]);
}

/** How many price-like numbers the text has (dates, times and phones excluded). */
export function priceNumberCount(text: string): number {
  const p = prepare(text);
  return p ? plainNumbers(p.folded).length : 0;
}

/** A digit sequence (after spoken dollar amounts became digits). */
export function hasPriceNumber(text: string): boolean {
  const p = prepare(text);
  return !!p && plainNumbers(p.folded).length > 0;
}

const FILLER = new Set(
  (
    "hola oye ojo hoy ahora ayer para por con que los las del una uno unos unas esta estan " +
    "subio bajo cuesta cuestan precio precios costo vale valen sale salen dolar dolares usd " +
    "cada pasa paso quedo muy mas pero como cuanto gracias favor buenos buenas dias tardes noches"
  ).split(" ")
);

/**
 * Cheap gate for the AI fallback: a number AND a plausible product word, and
 * not stock/recipe talk (unless a price word is there).
 */
export function isPriceAiCandidate(text: string): boolean {
  const p = prepare(text);
  if (!p) return false;
  if (REPORT_WORD.test(p.folded) && !LOOSE_PRICE_WORD.test(p.folded)) {
    return false;
  }
  if (plainNumbers(p.folded).length === 0) return false;
  const words = p.folded.match(/[a-zñ]{3,}/g) ?? [];
  return words.some(
    (w) => !FILLER.has(w) && !new RegExp("^" + UNIT + "$").test(w)
  );
}

/**
 * «Looks like a price»: a number plus a price word, a currency, a per-unit
 * marker followed by a word («la onzs»). Stock reports, recipes, dates and
 * phone numbers are not.
 */
export function looksLikePriceIntent(text: string): boolean {
  const p = prepare(text);
  if (!p) return false;
  const f = p.folded;
  if (REPORT_WORD.test(f) && !LOOSE_PRICE_WORD.test(f)) return false;
  if (plainNumbers(f).length === 0) return false;
  if (LOOSE_PRICE_WORD.test(f) || PRICE_VERB.test(f)) return true;
  if (/\$|\b(?:dolar(?:es)?|usd|dlls?|dls)\b/.test(f)) return true;
  for (const m of f.matchAll(NUMBER_RE)) {
    const start = m.index ?? 0;
    const before = f.slice(0, start).trim();
    const after = f.slice(start + m[0].length).replace(/^[\s)\]]+/, " ");
    if (!/[a-zñ]/.test(before)) continue; // a product word before the number
    if (/^\s*(?:c\/u|cada\s+un[oa])(?![a-z])/.test(after)) return true;
    if (/^\s*(?:\/|por\s+|la\s+|el\s+|x\s+)\s*[a-zñ]{2,}/.test(after)) {
      return true;
    }
    if (/[.,]\d{1,2}$/.test(m[2]) && /^[\s.!?)]*$/.test(after)) return true;
  }
  return false;
}

/** A unit alone as an answer: «libra», «por onza», «la unidad», «kg». */
export function parseUnitAnswer(text: string): string | null {
  if (typeof text !== "string") return null;
  const t = fold(text.toLowerCase())
    .replace(/[¡!¿?.,;:"'«»]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 30) return null;
  if (/^(?:es\s+)?(?:c\/u|cada\s+un[oa])$/.test(t)) return "unidad";
  const m = new RegExp(
    "^(?:(?:es|son)\\s+)?(?:(?:por|la|el|en|x|a la|al)\\s+)?" + UNIT + "$"
  ).exec(t);
  if (!m) return null;
  return canonicalUnit(m[1], m[1]);
}

/**
 * The unit a message itself names next to a price («la libra», «por kilo»,
 * «c/u»): one canonical unit, or null when it names none or several. The AI's
 * unit is only kept when it equals this; a unit is never invented.
 */
export function unitSaidInText(text: string): string | null {
  if (typeof text !== "string") return null;
  const t = fold(text.toLowerCase());
  const found = new Set<string>();
  if (/(?:^|[^a-z])(?:c\/u|cada\s+un[oa])(?![a-z])/.test(t))
    found.add("unidad");
  const re = new RegExp(
    "(?:^|[^a-z])(?:por|la|el|x|al|en)\\s+" + UNIT + "(?![a-z])",
    "g"
  );
  for (const m of t.matchAll(re)) found.add(canonicalUnit(m[1], m[1]));
  return found.size === 1 ? [...found][0] : null;
}

/** A numeric token as the literal amount it says, or null («1,500», «0»). */
function literalAmount(token: string): number | null {
  return parseNumber(token);
}

/**
 * All the amounts a text literally says, after spoken prices became digits
 * («uno cincuenta» -> 1.5). Decimal-aware: «1.50» yields 1.5, never 1 or 5;
 * numbers glued to other digits (phones «7150-2233», dates, times) yield
 * nothing. Used to check that an amount from the AI is really in the message.
 */
export function extractNumberTokens(text: string): number[] {
  const p = prepare(text);
  if (!p) return [];
  const out: number[] = [];
  for (const m of p.folded.matchAll(NUMBER_RE)) {
    const v = literalAmount(m[2]);
    if (v !== null) out.push(v);
  }
  return out;
}

/**
 * A bare amount as an answer to «¿1.50 o 150?»: «1.50», «150», «$150.»,
 * «uno cincuenta», «ciento cincuenta», «150 dólares». Returns the amount
 * literally said («150» -> 150, «1.50» -> 1.5, «uno cincuenta» -> 1.5), or
 * null when the text is not just an amount.
 */
export function parseAmountAnswer(text: string): number | null {
  if (typeof text !== "string") return null;
  let t = fold(text.toLowerCase())
    .replace(/[¡!¿?"'«»]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:\s]+$/, "");
  if (!t || t.length > 40) return null;
  t = t.replace(/^(?:son|es|serian|seria|a|en|de|pues)\s+/, "");
  const cur =
    "(?:\\s*(?:usd|dolar(?:es)?|dlls?|pesos?|mxn|colones?|crc|quetzales?|gtq|lempiras?|hnl|soles|pen|euros?|eur|cordobas?|nio))?";
  // Digits: «1.50», «150», «$150», «q150», «150 dólares».
  const digits = new RegExp(
    "^(?:[$€₡]|q(?=\\d)|mx\\$|us\\$)?\\s*(\\d+(?:[.,]\\d+)*)" + cur + "$"
  ).exec(t);
  if (digits) return literalAmount(digits[1]);
  // «un dólar cincuenta», «dos dólares con cincuenta»...
  const spoken = normalizeSpokenPrices(t);
  if (spoken !== t) {
    const m = new RegExp("^(\\d+(?:\\.\\d+)?)\\s+dolares?$").exec(fold(spoken));
    if (m) return literalAmount(m[1]);
  }
  const words = t.replace(cur + "$", "").trim();
  // «ciento cincuenta», «doscientos»
  const first = words.split(" ")[0];
  if ((WORD_VALUES[first] ?? 0) >= 100) {
    const v = wordsToNumber(words);
    return v !== null && v > 0 && v <= MAX_PRICE ? v : null;
  }
  // «uno cincuenta», «tres con cincuenta»: dollars then cents.
  const pair = new RegExp(
    `^(${NUM_WORD})(?:\\s+(?:con|y))?\\s+(${NUM_WORD})$`
  ).exec(words);
  if (pair) {
    const dollars = tokenValue(pair[1]);
    const cents = tokenValue(pair[2]);
    if (
      dollars !== null &&
      cents !== null &&
      dollars >= 1 &&
      dollars < 100 &&
      cents >= 10 &&
      cents <= 99
    ) {
      return Math.round((dollars + cents / 100) * 100) / 100;
    }
  }
  return null;
}

/** «la libra», «el kilo»… the way a person says it; other units: «por <unit>». */
const UNIT_PHRASE: Record<string, string> = {
  lb: "la libra",
  kg: "el kilo",
  unidad: "la unidad",
  pza: "la pieza",
  pieza: "la pieza",
  caja: "la caja",
  docena: "la docena",
  litro: "el litro",
  galón: "el galón",
  botella: "la botella",
  bolsa: "la bolsa",
  paquete: "el paquete",
  saco: "el saco",
  atado: "el atado",
  manojo: "el manojo",
  lata: "la lata",
  quintal: "el quintal",
  arroba: "la arroba",
  bandeja: "la bandeja",
  frasco: "el frasco",
  gramo: "el gramo",
  onza: "la onza",
  oz: "la onza",
  g: "el gramo",
};

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  MXN: "$",
  CRC: "₡",
  GTQ: "Q",
  HNL: "L",
  PEN: "S/",
  EUR: "€",
  NIO: "C$",
};

/** The currency's own symbol («$», «€», «Q»…), from the ISO code. «$» when unknown. */
export function currencySymbolFor(code: string | null | undefined): string {
  if (!code) return "$";
  const own = CURRENCY_SYMBOLS[code.toUpperCase()];
  if (own) return own;
  try {
    const part = new Intl.NumberFormat("es", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(1)
      .find((p) => p.type === "currency");
    return part?.value ?? "$";
  } catch {
    return "$";
  }
}

/** Unit names for reply copy in English and German («per lb», «pro Pfund»). */
const UNIT_NAMES: Record<"en" | "de", Record<string, string>> = {
  en: {
    lb: "lb",
    kg: "kg",
    unidad: "unit",
    pza: "piece",
    pieza: "piece",
    caja: "box",
    docena: "dozen",
    litro: "liter",
    galón: "gallon",
    botella: "bottle",
    bolsa: "bag",
    paquete: "pack",
    saco: "sack",
    atado: "bunch",
    manojo: "bunch",
    lata: "can",
    quintal: "quintal",
    arroba: "arroba",
    bandeja: "tray",
    frasco: "jar",
    gramo: "g",
    onza: "oz",
    oz: "oz",
    g: "g",
  },
  de: {
    lb: "Pfund",
    kg: "kg",
    unidad: "Stück",
    pza: "Stück",
    pieza: "Stück",
    caja: "Kiste",
    docena: "Dutzend",
    litro: "Liter",
    galón: "Gallone",
    botella: "Flasche",
    bolsa: "Beutel",
    paquete: "Packung",
    saco: "Sack",
    atado: "Bund",
    manojo: "Bund",
    lata: "Dose",
    quintal: "Zentner",
    arroba: "Arroba",
    bandeja: "Tablett",
    frasco: "Glas",
    gramo: "g",
    onza: "Unze",
    oz: "Unze",
    g: "g",
  },
};

/** «aguacate $1.50 la libra, tomate $0.80 la libra» for reply copy. */
export function formatPriceUpdateItems(
  items: PriceUpdateItem[],
  currencySymbol = "$"
): string {
  const lang = currentKitchenLanguage();
  return items
    .map((i) => {
      const unit = i.unit.toLowerCase();
      const per =
        lang === "es"
          ? (UNIT_PHRASE[unit] ?? `por ${i.unit}`)
          : renderKitchenCopy(KITCHEN_COPY.FRAG_PER_UNIT, {
              unidad: UNIT_NAMES[lang][unit] ?? i.unit,
            });
      const price =
        lang === "de"
          ? i.price.toFixed(2).replace(".", ",")
          : i.price.toFixed(2);
      return `${i.name} ${currencySymbol}${price} ${per}`;
    })
    .join(", ");
}
