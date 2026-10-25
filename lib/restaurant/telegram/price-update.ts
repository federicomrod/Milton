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
  /\b(receta|recetas|ingredientes?|llegaron|llego|quedan|queda|se acabo|se acabaron|merma|desperdicio|porcion|porciones|86)\b/;

const UNIT =
  "(libras?|lbs?|kilogramos?|kilos?|kgs?|unidad(?:es)?|piezas?|pzas?|pzs?|pz|cajas?|docenas?|litros?|lts?|galon(?:es)?|botellas?|bolsas?|paquetes?|sacos?|atados?|manojos?|latas?|quintal(?:es)?|arrobas?|bandejas?|frascos?|gramos?|onzas?|oz|g)(?![a-zñ])";
const NUMBER_RE =
  /(\$\s*)?(?<![\d:/.,-])(\d+(?:[.,]\d+)*)(?!\d|[:/-]\d|[.,]\d)/g;

function canonicalUnit(foldedUnit: string, written: string): string {
  if (/^(libras?|lbs?)$/.test(foldedUnit)) return "lb";
  if (/^(kilogramos?|kilos?|kgs?)$/.test(foldedUnit)) return "kg";
  if (/^unidad(es)?$/.test(foldedUnit)) return "unidad";
  if (/^(pzas?|pzs?|pz)$/.test(foldedUnit)) return "pza";
  return written;
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
  | { state: "unclear" }
  | { state: "none" };

function parseSegment(folded: string, original: string): SegmentResult {
  const hasVerb = PRICE_VERB.test(folded);
  const matches = [...folded.matchAll(NUMBER_RE)];
  const hasLoose = LOOSE_PRICE_WORD.test(folded) || /\$|dolar|usd/.test(folded);
  if (matches.length === 0) {
    return hasLoose ? { state: "unclear" } : { state: "none" };
  }

  const first = matches[0];
  const nameEnd = first.index ?? 0;
  const candidates: Array<
    { ok: true; price: number; unit: string } | { ok: false }
  > = [];

  for (const m of matches) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const dollarPrefix = !!m[1];
    let pos = end;
    const rest = folded.slice(pos);

    const cur = /^\s*(?:usd|dolares?|\$)/.exec(rest);
    const currency = !!cur;
    if (cur) pos += cur[0].length;

    let marker = false;
    let unit: string | null = null;
    const cu = /^\s*c\/u(?![a-z])/.exec(folded.slice(pos));
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

    const relevant =
      hasVerb || dollarPrefix || currency || (marker && unit !== null);
    if (!relevant) continue;

    const price = parseNumber(m[2]);
    if (unit === null || price === null) candidates.push({ ok: false });
    else candidates.push({ ok: true, price, unit });
  }

  if (candidates.length === 0) {
    return hasLoose ? { state: "unclear" } : { state: "none" };
  }
  if (candidates.length > 1 && candidates.filter((c) => c.ok).length !== 1) {
    return { state: "unclear" };
  }
  const good = candidates.filter((c) => c.ok);
  const pick = good.length === 1 ? good[0] : candidates[0];
  if (!pick.ok) return { state: "unclear" };
  // More than one fully valid price in one segment: ambiguous.
  if (candidates.length > 1 && candidates.some((c) => !c.ok) && !hasVerb) {
    return { state: "unclear" };
  }

  const name = cleanName(folded, original, 0, nameEnd);
  if (!name) return { state: "unclear" };
  return { state: "item", item: { name, price: pick.price, unit: pick.unit } };
}

export function parsePriceUpdate(text: string): PriceUpdateParse {
  if (typeof text !== "string") return null;
  const original = text.toLowerCase().replace(/\s+/g, " ").trim();
  if (!original) return null;
  const folded = fold(original);

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

  const items: PriceUpdateItem[] = [];
  let unclear = false;
  for (const [f, o] of segments) {
    const r = parseSegment(f, o);
    if (r.state === "item") items.push(r.item);
    else if (r.state === "unclear") unclear = true;
  }

  if (unclear) return { kind: "price_intent_unclear" };
  if (items.length > 0) {
    return {
      kind: "price_update",
      items: items.slice(0, PRICE_UPDATE_MAX_ITEMS),
    };
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
