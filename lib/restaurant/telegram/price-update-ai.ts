/**
 * AI fallback for price messages the rules could not read («aguacate a uno
 * cincuenta la onza»). ONE short JSON-mode call, ~15 s timeout, no retries,
 * the same shared client / model as the other Telegram captures.
 *
 * The model only proposes; `validateAiItems` decides. Every item carries
 * `said`, the exact piece of the transcript its price came from: the price
 * must equal the deterministic reading of `said`, the product must be words
 * of the transcript (the saved name is the TRANSCRIPT's wording), the unit
 * must be said next to the price. Nothing is invented. A failed item is
 * dropped on its own. Any failure returns null (= «not parsed»).
 *
 * SECURITY: logs nothing but a fixed failure line. Never the text.
 */

import {
  createOpenAIClient,
  openAiModel,
} from "@/lib/restaurant/openai-client";
import {
  hasPriceShape,
  looksLikeCents,
  normalizeSpokenPrices,
  parseUnitAnswer,
  PRICE_UPDATE_MAX_ITEMS,
} from "./price-update";

export const PRICE_AI_TIMEOUT_MS = 15000;
/** ~25 items of a spoken list fit comfortably. */
export const PRICE_AI_TEXT_CHARS = 1500;

export type PriceAiItem = {
  product: string;
  price: number;
  unit: string | null;
  currency: string | null;
  said: string;
};

/** Injectable (tests): returns the raw proposed items, or null on any failure. */
export type PriceAi = (text: string) => Promise<unknown>;

const SYSTEM_PROMPT = `Lees un mensaje de un cocinero (texto o nota de voz transcrita) con precios de ingredientes. Puede traer varios.
Devuelve SOLO JSON: {"items":[{"product":string,"price":number,"unit":string|null,"currency":string|null,"said":string}]}
Reglas estrictas:
- Solo precios que aparecen en el mensaje. Nunca inventes un precio, un producto ni una unidad.
- "said" es el pedazo EXACTO del mensaje de donde sale el precio (copiado tal cual, por ejemplo "uno cincuenta la libra"). Sin "said" exacto, no incluyas el item.
- "price" es el número tal como se dijo (1,50 -> 1.5; "un dólar cincuenta" -> 1.5; "uno cincuenta" -> 1.5; "75 centavos" -> 0.75).
- Un número de 3 cifras sin punto ni moneda ("150") es ambiguo: no lo incluyas.
- "unit" es la unidad en que se dijo el precio (libra, onza, kilo, unidad, caja...). Si no se dijo junto a ese precio, null.
- "currency" solo si se dijo (USD, dólares, $); si no, null.
- Productos sin precio ("no tiene precio") no se incluyen.
- Si el mensaje no trae un precio de un producto, devuelve {"items":[]}.
- Cantidades, pedidos, recetas, fechas y teléfonos no son precios.`;

export const askPriceAi: PriceAi = async (text) => {
  const made = await createOpenAIClient(PRICE_AI_TIMEOUT_MS);
  if (!made.ok) return null;
  try {
    const completion = await made.client.chat.completions.create({
      model: openAiModel(),
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, PRICE_AI_TEXT_CHARS) },
      ],
    });
    const raw = completion.choices?.[0]?.message?.content ?? "";
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    console.error("[price-update-ai] call failed");
    return null;
  }
};

const ACCENTS: Record<string, string> = {
  á: "a",
  é: "e",
  í: "i",
  ó: "o",
  ú: "u",
  ü: "u",
};
/** Same length as the input, so indices map back to the original text. */
function fold(s: string): string {
  return s.toLowerCase().replace(/[áéíóúü]/g, (c) => ACCENTS[c] ?? c);
}

/** Every price-like number in the text, as written (a decimal comma or point; never «1,500»). */
function numberTokens(text: string): string[] {
  const out: string[] = [];
  const re = /(?<![\d:/.,-])(\d+(?:[.,]\d+)*)(?!\d|[:/-]\d|[.,]\d)/g;
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}
function tokenValue(t: string): number | null {
  if (/^\d+$/.test(t)) return Number(t);
  if (/^\d+[.,]\d{1,2}$/.test(t)) return Number(t.replace(",", "."));
  return null;
}

const STOP = new Set(
  "de del la el los las un una unos unas y a en con para por al lo que".split(
    " "
  )
);

function sameWord(a: string, b: string): boolean {
  return (
    a === b ||
    a + "s" === b ||
    a + "es" === b ||
    b + "s" === a ||
    b + "es" === a
  );
}

type Word = { raw: string; folded: string; start: number; end: number };
function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  for (const m of text.matchAll(/[a-zñáéíóúü]+/g)) {
    const start = m.index ?? 0;
    out.push({
      raw: m[0],
      folded: fold(m[0]),
      start,
      end: start + m[0].length,
    });
  }
  return out;
}

/**
 * The product in the TRANSCRIPT's own words: the longest run of the AI's
 * product words that appears in the text, accent- and plural-insensitive,
 * nearest before the price. «masa de maíz» with «masa» in the text -> «masa».
 */
function productInText(
  product: string,
  hay: string,
  priceAt: number
): string | null {
  const p = wordsOf(product);
  const h = wordsOf(hay);
  if (p.length === 0 || p.length > 5) return null;
  for (let len = p.length; len >= 1; len--) {
    for (let i = 0; i + len <= p.length; i++) {
      const sub = p.slice(i, i + len);
      if (sub.every((w) => STOP.has(w.folded))) continue;
      if (sub.length === 1 && parseUnitAnswer(sub[0].raw) !== null) continue;
      let best: { from: number; to: number; dist: number } | null = null;
      for (let j = 0; j + len <= h.length; j++) {
        if (!sub.every((w, k) => sameWord(w.folded, h[j + k].folded))) continue;
        const end = h[j + len - 1].end;
        const dist = end <= priceAt ? priceAt - end : 1e6 + (end - priceAt);
        if (!best || dist < best.dist) best = { from: j, to: j + len, dist };
      }
      if (best) {
        // Never end on a connector («masa de»).
        let { from, to } = best;
        while (to > from && STOP.has(h[to - 1].folded)) to--;
        while (from < to && STOP.has(h[from].folded)) from++;
        if (from >= to) continue;
        const name = h
          .slice(from, to)
          .map((w) => w.raw)
          .join(" ");
        return name.length <= 40 ? name : null;
      }
    }
  }
  return null;
}

export type ValidatedAiItem = {
  name: string;
  price: number;
  unit: string | null;
  /** The piece of the (normalized) transcript the price came from, folded. */
  said: string;
};

/**
 * Keeps only items that are provably in the text; each failed item is
 * dropped on its own. Returns [] when nothing survives (or the answer has
 * the wrong shape).
 */
export function validateAiItems(raw: unknown, text: string): ValidatedAiItem[] {
  const inner =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { items?: unknown }).items
      : raw;
  if (!Array.isArray(inner)) return [];
  const list: unknown[] = inner;
  const lowerRaw = text.toLowerCase().replace(/\s+/g, " ").trim();
  const lowerNorm = normalizeSpokenPrices(lowerRaw);
  const foldedRaw = fold(lowerRaw);
  const foldedNorm = fold(lowerNorm);
  const out: ValidatedAiItem[] = [];
  for (const entry of list.slice(0, PRICE_UPDATE_MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const price = e.price;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    if (price <= 0 || price > 100000) continue;

    // 1. `said` is a piece of the transcript.
    if (typeof e.said !== "string") continue;
    const saidLower = e.said.toLowerCase().replace(/\s+/g, " ").trim();
    if (saidLower.length < 1 || saidLower.length > 120) continue;
    const saidFolded = fold(saidLower);
    let hay = lowerNorm;
    let idx = foldedNorm.indexOf(saidFolded);
    if (idx < 0) {
      hay = lowerRaw;
      idx = foldedRaw.indexOf(saidFolded);
    }
    if (idx < 0) continue;

    // 2. The price is the deterministic reading of `said`.
    const saidNorm = normalizeSpokenPrices("x a " + saidLower).slice(4);
    const hasCurrency = /\$|dolar|usd|centavo/.test(fold(saidNorm));
    const tokens = numberTokens(saidNorm).filter((t) => {
      const v = tokenValue(t);
      return v !== null && Math.abs(v - price) < 1e-9;
    });
    if (tokens.length === 0) continue;
    if (!hasCurrency && tokens.some((t) => looksLikeCents(t))) continue;

    // 3. The piece (and the two words after it, «la libra») has the shape of
    //    a price: a quantity cannot borrow a price from its neighbour.
    const end = idx + saidLower.length;
    const next = hay.slice(end).trimStart().split(/\s+/).slice(0, 2).join(" ");
    if (
      !hasPriceShape(normalizeSpokenPrices(`x a ${saidLower} ${next}`).slice(4))
    ) {
      continue;
    }
    const tail = hay.slice(end, end + 25);
    const cut = tail.search(/[.;]\s|,\s|\sy\s|$/);
    const window = hay.slice(idx, end + (cut < 0 ? tail.length : cut));

    // 4. The product, in the transcript's words.
    const product = typeof e.product === "string" ? e.product.trim() : "";
    if (!product || product.length > 60) continue;
    const name = productInText(product, hay, idx);
    if (!name || !/^[a-zñáéíóúü]+(?: [a-zñáéíóúü]+){0,3}$/.test(name)) continue;

    // 5. The unit is said next to the price.
    let unit: string | null = null;
    if (e.unit !== null && e.unit !== undefined && e.unit !== "") {
      if (typeof e.unit !== "string") continue;
      const parsed = parseUnitAnswer(e.unit);
      if (parsed === null) continue; // an unknown unit word: never trusted
      unit = unitSaid(fold(window), e.unit) ? parsed : null;
    }
    out.push({ name, price, unit, said: fold(saidNorm).trim() });
  }
  return out;
}

function unitSaid(foldedWindow: string, aiUnit: string): boolean {
  const u = fold(aiUnit).replace(/[^a-zñ/]/g, "");
  if (!u) return false;
  // «libra» said as «lb», «onzs»...: accept any word that parses as the same unit.
  const wanted = parseUnitAnswer(aiUnit);
  return foldedWindow
    .split(/[^a-zñ/]+/)
    .some((w) => w && (w === u || parseUnitAnswer(w) === wanted));
}
