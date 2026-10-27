// lib/restaurant/ask-milton-count.ts
//
// «cuáles son mis tres platos con peores márgenes?» → 3.
// Reads how many items the owner asked for (words or digits, Spanish or
// English) so every list answer returns exactly that many. Null when the
// question names no count: each answer keeps its own default.
//
// Only a number next to a list word counts («3 platos», «top 5», «los
// cinco mejores»), so «últimos 7 días» or «mayo 2026» never change a list.

export const ASK_MILTON_MAX_COUNT = 10;

const NUMBER_WORDS: Record<string, number> = {
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
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

// Words that make a number a list size.
const LIST_WORDS = [
  "platos?",
  "platillos?", // input matcher: keep «platillo»
  "productos?",
  "articulos?",
  "items?",
  "ingredientes?",
  "insumos?",
  "proveedores?",
  "facturas?",
  "recetas?",
  "dishes",
  "dish",
  "ingredients?",
  "suppliers?",
  "invoices?",
  "recipes?",
  "products?",
  "menu items?",
  "mejores",
  "peores",
  "primeros",
  "primeras",
  "principales",
  "mas",
  "menos",
  "best",
  "worst",
  "top",
  "most",
  "least",
  "highest",
  "lowest",
  "biggest",
].join("|");

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}

function toNumber(token: string): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  return NUMBER_WORDS[token] ?? null;
}

const NUM = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
const TOP_RE = new RegExp(`\\btop\\s*-?\\s*${NUM}\\b`);
const NUM_BEFORE_LIST_RE = new RegExp(`\\b${NUM}\\s+(?:${LIST_WORDS})\\b`);

/** How many items the question asks for (1–10), or null when it names none. */
export function parseRequestedCount(message: string): number | null {
  const m = fold(message);
  const top = m.match(TOP_RE);
  const match = top ?? m.match(NUM_BEFORE_LIST_RE);
  if (!match) return null;
  const token = match[1];
  // «una» / «uno» / «one» before a noun is an article far more often than a
  // count («una lista de platos»): only «top 1» or the digit «1» count.
  if (!top && (token === "una" || token === "uno" || token === "one")) {
    return null;
  }
  const n = toNumber(token);
  if (n === null || n < 1) return null;
  return Math.min(n, ASK_MILTON_MAX_COUNT);
}

/** The requested count, or `fallback` when the question names none. */
export function listSize(message: string, fallback: number): number {
  return parseRequestedCount(message) ?? fallback;
}
