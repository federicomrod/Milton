/**
 * AI fallback for price messages the rules could not read («aguacate a uno
 * cincuenta la onza»). ONE short JSON-mode call, ~15 s timeout, no retries,
 * the same shared client / model as the other Telegram captures.
 *
 * The model only proposes; `validateAiItems` decides. Every price must be a
 * number that is literally in the cook's text, every product a word that is
 * in the text, every unit a known unit word or null. Nothing is invented.
 * Any failure returns null (= «not parsed»).
 *
 * SECURITY: logs nothing but a fixed failure line. Never the text.
 */

import {
  createOpenAIClient,
  openAiModel,
} from "@/lib/restaurant/openai-client";
import {
  normalizeSpokenPrices,
  parseUnitAnswer,
  PRICE_UPDATE_MAX_ITEMS,
} from "./price-update";

export const PRICE_AI_TIMEOUT_MS = 15000;

export type PriceAiItem = {
  product: string;
  price: number;
  unit: string | null;
  currency: string | null;
};

/** Injectable (tests): returns the raw proposed items, or null on any failure. */
export type PriceAi = (text: string) => Promise<unknown>;

const SYSTEM_PROMPT = `Lees un mensaje corto de un cocinero (texto o nota de voz transcrita) sobre el precio de ingredientes.
Devuelve SOLO JSON: {"items":[{"product":string,"price":number,"unit":string|null,"currency":string|null}]}
Reglas estrictas:
- Solo precios que aparecen en el mensaje. Nunca inventes un precio, un producto ni una unidad.
- "price" es el número tal como se dijo (1,50 -> 1.5; "un dólar cincuenta" -> 1.5).
- "unit" es la unidad en que se dijo el precio (libra, onza, kilo, unidad, caja...). Si no se dijo, null.
- "currency" solo si se dijo (USD, dólares, $); si no, null.
- Si el mensaje no trae un precio de un producto, devuelve {"items":[]}.
- Cantidades, pedidos, recetas, fechas y teléfonos no son precios.`;

export const askPriceAi: PriceAi = async (text) => {
  const made = await createOpenAIClient(PRICE_AI_TIMEOUT_MS);
  if (!made.ok) return null;
  try {
    const completion = await made.client.chat.completions.create({
      model: openAiModel(),
      temperature: 0,
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, 600) },
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
function fold(s: string): string {
  return s.toLowerCase().replace(/[áéíóúü]/g, (c) => ACCENTS[c] ?? c);
}

/** Every price-like number in the text (a decimal comma or point; never «1,500»). */
function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\d:/.,-])(\d+(?:[.,]\d+)*)(?!\d|[:/-]\d|[.,]\d)/g;
  for (const m of text.matchAll(re)) {
    const t = m[1];
    if (/^\d+$/.test(t)) out.push(Number(t));
    else if (/^\d+[.,]\d{1,2}$/.test(t)) out.push(Number(t.replace(",", ".")));
  }
  return out;
}

export type ValidatedAiItem = {
  name: string;
  price: number;
  unit: string | null;
};

/**
 * Keeps only items that are provably in the text. Returns [] when nothing
 * survives (or the AI answer has the wrong shape).
 */
export function validateAiItems(raw: unknown, text: string): ValidatedAiItem[] {
  const inner =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as { items?: unknown }).items
      : raw;
  if (!Array.isArray(inner)) return [];
  const list: unknown[] = inner;
  const spoken = normalizeSpokenPrices(text.toLowerCase());
  const foldedText = fold(spoken);
  const present = numbersIn(spoken);
  const out: ValidatedAiItem[] = [];
  for (const entry of list.slice(0, PRICE_UPDATE_MAX_ITEMS)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const price = e.price;
    if (typeof price !== "number" || !Number.isFinite(price)) continue;
    if (price <= 0 || price > 100000) continue;
    if (!present.some((n) => Math.abs(n - price) < 1e-9)) continue;

    const product = typeof e.product === "string" ? e.product.trim() : "";
    if (!/^[a-zñáéíóúü]+(?: [a-zñáéíóúü]+){0,3}$/i.test(product)) continue;
    if (product.length > 40) continue;
    if (!foldedText.includes(fold(product))) continue;

    let unit: string | null = null;
    if (e.unit !== null && e.unit !== undefined && e.unit !== "") {
      if (typeof e.unit !== "string") continue;
      const parsed = parseUnitAnswer(e.unit);
      if (parsed === null) continue; // an unknown unit word: never trusted
      // A unit that is not in the text was invented: ask instead.
      unit = unitSaid(foldedText, e.unit) ? parsed : null;
    }
    out.push({ name: product.toLowerCase(), price, unit });
  }
  return out;
}

function unitSaid(foldedText: string, aiUnit: string): boolean {
  const u = fold(aiUnit).replace(/[^a-zñ/]/g, "");
  if (!u) return false;
  if (foldedText.includes(u)) return true;
  // «libra» said as «lb», «onzs»...: accept any text word that parses as the same unit.
  const wanted = parseUnitAnswer(aiUnit);
  return foldedText
    .split(/[^a-zñ/]+/)
    .some((w) => w && parseUnitAnswer(w) === wanted);
}
