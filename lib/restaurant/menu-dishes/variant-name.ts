// lib/restaurant/menu-dishes/variant-name.ts
//
// Read a POS variant's name into its menu dish and attributes (R1-10).
// Odoo sells one product per combination, with the options in the name:
//   "<Dish> (<size>) (<side>, <side>, <cooking point>)"
//   "<Dish> 6oz. (Eventos) (<cooking point>, <side>)"
//   "<Dish> (3 personas)"   "<DISH> (EVENTO)"   "<Dish> (4 oz) (PROMO) (…)"
// Pure; no client data lives here (tests use synthetic names).

export interface VariantName {
  /** The dish part as written (accents and case kept), size removed. */
  base: string;
  /** Grouping key: lowercase, no accents, simple plurals folded. */
  key: string;
  /** Portion, when the name says it: 6 (oz), 3 (personas). */
  portion_qty: number | null;
  portion_unit: "oz" | "personas" | null;
  /** Options that are not a cooking point or a tag (sides, breads, eggs). */
  sides: string[];
  /** "Bien Cocido", "3/4", "1/2"…; never changes the cost. */
  cooking_point: string | null;
  is_event: boolean;
  is_promo: boolean;
}

const SIZE_RE =
  /(\d+(?:[.,]\d+)?)\s*(onzas|onza|onz|oz|personas|persona|pers|p)\.?(?=\s|\)|,|$)/i;
const COOKING_RE =
  /^(bien cocido|t[eé]rmino medio|medio cocido|3\/4|1\/2|1\/4|rojo|azul)$/i;
const EVENT_RE = /^eventos?$/i;
const PROMO_RE = /^promo(ci[oó]n)?$/i;

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Lowercase, no accents or punctuation, simple plurals folded. */
export function dishKey(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

function sizeOf(text: string): { qty: number; unit: "oz" | "personas" } | null {
  const m = text.match(SIZE_RE);
  if (!m) return null;
  const qty = Number(m[1].replace(",", "."));
  if (!Number.isFinite(qty) || qty <= 0) return null;
  return { qty, unit: /^p/i.test(m[2]) ? "personas" : "oz" };
}

export function parseVariantName(name: string): VariantName {
  const raw = name.replace(/\s+/g, " ").trim();
  const open = raw.indexOf("(");
  let head = (open >= 0 ? raw.slice(0, open) : raw).trim();
  const groups = [...raw.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim());

  let portion: { qty: number; unit: "oz" | "personas" } | null = null;
  const headSize = sizeOf(head);
  if (headSize) {
    portion = headSize;
    head = head.replace(SIZE_RE, "").replace(/\s+/g, " ").trim();
  }

  const sides: string[] = [];
  let cooking: string | null = null;
  let isEvent = false;
  let isPromo = false;
  for (const group of groups) {
    const whole = group.trim();
    if (!whole) continue;
    const size = sizeOf(whole);
    if (size && whole.replace(SIZE_RE, "").trim() === "") {
      portion = portion ?? size;
      continue;
    }
    for (const token of whole
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)) {
      if (EVENT_RE.test(token)) isEvent = true;
      else if (PROMO_RE.test(token)) isPromo = true;
      else if (COOKING_RE.test(token)) cooking = cooking ?? token;
      else if (sizeOf(token) && token.replace(SIZE_RE, "").trim() === "") {
        portion = portion ?? sizeOf(token);
      } else sides.push(token);
    }
  }

  const base = head.replace(/[.\s]+$/, "").trim() || raw;
  return {
    base,
    key: dishKey(base),
    portion_qty: portion?.qty ?? null,
    portion_unit: portion?.unit ?? null,
    sides,
    cooking_point: cooking,
    is_event: isEvent,
    is_promo: isPromo,
  };
}

/** Edit distance, for one-letter typos in long dish names. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Same dish despite a typo ("Pariillada" vs "Parrillada"). */
export function sameDishKey(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 10) return false;
  return distance(a, b) <= 1;
}

// ---------------------------------------------------------------------------
// Automatic exclusion (bebidas, extras, modificadores…)
// ---------------------------------------------------------------------------

const EXCLUDED_CATEGORIES: Array<[RegExp, string]> = [
  [
    /bebida|cerveza|licor|vino|digestivo|caf[eé]|b\.\s*calientes|descorche|refil/i,
    "bebida",
  ],
  [/extra|salsa|modificador|adicional/i, "extra"],
  [/empleado/i, "empleados"],
  [/descuento/i, "descuento"],
];

const DRINK_NAME =
  /\b(vino|cerveza|tona|tonas|victoria|pilsener|coca|pepsi|soda|agua|limonada|refresco|michelada|ron|whisky|tequila|vodka|sangria)\b/i;

/** Why a product is out of food costing, or null when it is food. */
export function exclusionFor(input: {
  name: string;
  category: string | null;
}): string | null {
  const category = input.category ?? "";
  for (const [re, reason] of EXCLUDED_CATEGORIES) {
    if (re.test(category)) return reason;
  }
  // A drink sold inside "Promociones" (a bottle, a bucket of beer).
  if (DRINK_NAME.test(stripAccents(input.name))) return "bebida";
  return null;
}
