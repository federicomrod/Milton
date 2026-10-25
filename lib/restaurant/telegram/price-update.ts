/**
 * Pure, deterministic parser for ingredient price messages sent to the
 * kitchen bot («el aguacate subió a 1.50 la libra»).
 *
 * No LLM, no I/O: every number in the result is copied from the text, so it
 * cannot invent prices. When in doubt it answers `price_intent_unclear`.
 */

export const PRICE_UPDATE_MAX_ITEMS = 10;
const MAX_PRICE = 100000;

export type PriceUpdateItem = { name: string; price: number; unit: string };

export type PriceUpdateParse =
  | { kind: "price_update"; items: PriceUpdateItem[] }
  | { kind: "price_intent_unclear" }
  | null;

/** A price whose unit was not said («queso 3.25»): the bot asks once. */
export type UnitlessPrice = { name: string; price: number };

export type PriceMessageParse =
  | { kind: "price_update"; items: PriceUpdateItem[] }
  | { kind: "needs_unit"; items: UnitlessPrice[] }
  | { kind: "price_intent_unclear" }
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
// Currency written after the number.
const CURRENCY_AFTER = /^\s*(?:usd|dolar(?:es)?|dlls?|dls|\$)/;
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
};
const ONES_W = "uno|una|un|dos|tres|cuatro|cinco|seis|siete|ocho|nueve";
const TENS_W = "treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa";
const UP_TO_29 = Object.keys(WORD_VALUES)
  .filter((w) => WORD_VALUES[w] < 30)
  .sort((a, b) => b.length - a.length)
  .join("|");
const NUM_WORD = `(?:(?:${TENS_W})(?:\\s+y\\s+(?:${ONES_W}))?|${UP_TO_29})`;
const SPOKEN_DOLLARS = new RegExp(
  `(?<![a-zñáéíóúü])(${NUM_WORD})\\s+d[oó]lar(?:es)?(?:\\s+(?:(con|y)\\s+(medio|${NUM_WORD})|(${NUM_WORD}))(?:\\s+centavos?)?(?![a-zñáéíóúü]))?`,
  "g"
);

function wordsToNumber(words: string): number | null {
  const parts = words.trim().split(/\s+/);
  if (parts.length === 1) return WORD_VALUES[parts[0]] ?? null;
  if (parts.length === 3 && parts[1] === "y") {
    const t = WORD_VALUES[parts[0]];
    const u = WORD_VALUES[parts[2]];
    return t !== undefined && u !== undefined ? t + u : null;
  }
  return null;
}

/** Lowercase text in, the same text with spoken dollar amounts as digits. */
export function normalizeSpokenPrices(lower: string): string {
  return lower.replace(
    SPOKEN_DOLLARS,
    (
      all: string,
      dollars: string,
      _connector: string | undefined,
      withConnector: string | undefined,
      bare: string | undefined
    ) => {
      const d = wordsToNumber(dollars);
      if (d === null) return all;
      const cents = withConnector ?? bare;
      if (!cents) return `${d} dólares`;
      const v = cents === "medio" ? 50 : wordsToNumber(cents);
      // «un dólar cinco» is not 1.05: a bare number needs 10 or more cents.
      if (v === null || v >= 100) return `${d} dólares ${cents}`;
      if (bare && v < 10) return `${d} dólares ${cents}`;
      return `${(d + v / 100).toFixed(2)} dólares`;
    }
  );
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
  left(/^(?:el\s+)?precios?\s+de(?:l|\s+(?:el|la|los|las))?\s+/);
  left(/^(?:el|la|los|las|un|una)\s+/);
  for (let i = 0; i < 3; i++) {
    right(
      /\s*(?:\b(?:ahora|hoy)\s+)?\b(?:subio|bajo|cuesta|esta|quedo|paso|sube|baja|vale|sale|cuestan|estan|subieron|bajaron|ahora)\s*(?:ahora\s*)?(?:(?:a|en|de|por)\s*)?$/
    );
    right(/\s*\b(?:a|en|de|por|del)\s*:?$/);
    right(/\s*:$/);
  }
  const name = original.slice(lo, hi).trim();
  if (!name) return null;
  if (name.length > 40 || name.split(" ").length > 4) return null;
  if (!/^[a-zñáéíóúü]+(?: [a-zñáéíóúü]+)*$/.test(name)) return null;
  return name;
}

type SegmentResult =
  | { state: "item"; item: PriceUpdateItem }
  | { state: "unitless"; item: UnitlessPrice }
  | { state: "unclear" }
  | { state: "none" };

type Candidate =
  | { ok: true; price: number; unit: string }
  | { ok: false; unitless?: number };

function parseSegment(folded: string, original: string): SegmentResult {
  const hasVerb = PRICE_VERB.test(folded);
  const matches = [...folded.matchAll(NUMBER_RE)];
  const hasLoose = LOOSE_PRICE_WORD.test(folded) || /\$|dolar|usd/.test(folded);
  if (matches.length === 0) {
    return hasLoose ? { state: "unclear" } : { state: "none" };
  }

  const first = matches[0];
  const nameEnd = first.index ?? 0;
  const candidates: Candidate[] = [];

  for (const m of matches) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const dollarPrefix = !!m[1];
    let pos = end;
    const rest = folded.slice(pos);

    const cur = CURRENCY_AFTER.exec(rest);
    const currency = !!cur;
    if (cur) pos += cur[0].length;
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
    const relevant =
      hasVerb ||
      dollarPrefix ||
      currency ||
      (marker && unit !== null) ||
      bareDecimal;
    if (!relevant) continue;

    const price = parseNumber(m[2]);
    if (price === null) candidates.push({ ok: false });
    else if (unit === null) {
      candidates.push(atEnd ? { ok: false, unitless: price } : { ok: false });
    } else candidates.push({ ok: true, price, unit });
  }

  if (candidates.length === 0) {
    return hasLoose ? { state: "unclear" } : { state: "none" };
  }
  if (candidates.length > 1 && candidates.filter((c) => c.ok).length !== 1) {
    return { state: "unclear" };
  }
  const good = candidates.filter((c) => c.ok);
  const pick = good.length === 1 ? good[0] : candidates[0];
  if (!pick.ok) {
    if (candidates.length === 1 && pick.unitless !== undefined) {
      const name = cleanName(folded, original, 0, nameEnd);
      if (!name) return { state: "unclear" };
      return { state: "unitless", item: { name, price: pick.unitless } };
    }
    return { state: "unclear" };
  }
  // More than one fully valid price in one segment: ambiguous.
  if (candidates.length > 1 && candidates.some((c) => !c.ok) && !hasVerb) {
    return { state: "unclear" };
  }

  const name = cleanName(folded, original, 0, nameEnd);
  if (!name) return { state: "unclear" };
  return { state: "item", item: { name, price: pick.price, unit: pick.unit } };
}

function prepare(text: string): { original: string; folded: string } | null {
  if (typeof text !== "string") return null;
  const lower = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!lower) return null;
  const original = normalizeSpokenPrices(lower);
  return { original, folded: fold(original) };
}

type Internal = {
  items: PriceUpdateItem[];
  unitless: UnitlessPrice[];
  unclear: boolean;
};

function parseInternal(folded: string, original: string): Internal | null {
  if (REPORT_WORD.test(folded) && !LOOSE_PRICE_WORD.test(folded)) return null;

  // Split on " y ", ", " and ";" (a decimal comma has no space after it).
  const segments: Array<[string, string]> = [];
  const splitter = /\s+y\s+|,\s+|;\s*/g;
  let last = 0;
  for (const m of folded.matchAll(splitter)) {
    const i = m.index ?? 0;
    segments.push([folded.slice(last, i), original.slice(last, i)]);
    last = i + m[0].length;
  }
  segments.push([folded.slice(last), original.slice(last)]);

  const out: Internal = { items: [], unitless: [], unclear: false };
  for (const [f, o] of segments) {
    const r = parseSegment(f, o);
    if (r.state === "item") out.items.push(r.item);
    else if (r.state === "unitless") out.unitless.push(r.item);
    else if (r.state === "unclear") out.unclear = true;
  }
  return out;
}

/** Items with a unit, or «unclear». A price without a unit is «unclear» here. */
export function parsePriceUpdate(text: string): PriceUpdateParse {
  const p = prepare(text);
  if (!p) return null;
  const r = parseInternal(p.folded, p.original);
  if (!r) return null;
  if (r.unclear || r.unitless.length > 0) {
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
 * Like parsePriceUpdate, but a message whose prices all lack a unit
 * («queso 3.25») comes back as `needs_unit` so the bot can ask once.
 * Mixed (some with, some without a unit) stays unclear: never guess.
 */
export function parsePriceMessage(text: string): PriceMessageParse {
  const p = prepare(text);
  if (!p) return null;
  const r = parseInternal(p.folded, p.original);
  if (!r) return null;
  if (r.unclear) return { kind: "price_intent_unclear" };
  if (r.unitless.length > 0) {
    if (r.items.length > 0) return { kind: "price_intent_unclear" };
    return {
      kind: "needs_unit",
      items: r.unitless.slice(0, PRICE_UPDATE_MAX_ITEMS),
    };
  }
  if (r.items.length > 0) {
    return {
      kind: "price_update",
      items: r.items.slice(0, PRICE_UPDATE_MAX_ITEMS),
    };
  }
  return null;
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

/** The currency's own symbol («$», «€», «Q»…), from the ISO code. «$» when unknown. */
export function currencySymbolFor(code: string | null | undefined): string {
  if (!code) return "$";
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

/** «aguacate $1.50 la libra, tomate $0.80 la libra» for reply copy. */
export function formatPriceUpdateItems(
  items: PriceUpdateItem[],
  currencySymbol = "$"
): string {
  return items
    .map((i) => {
      const per = UNIT_PHRASE[i.unit.toLowerCase()] ?? `por ${i.unit}`;
      return `${i.name} ${currencySymbol}${i.price.toFixed(2)} ${per}`;
    })
    .join(", ");
}
