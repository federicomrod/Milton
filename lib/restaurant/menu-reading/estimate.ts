// «Estimar con Milton»: pure logic, no I/O. For a dish with no recipe, the AI
// proposes quantities for ONE plate and a typical restaurant purchase price
// per ingredient. This is an overlay, never a real figure:
// - a real price always wins over an estimated one;
// - a missing price is «Sin precio» (null), never 0, and a dish whose lines
//   do not ALL have a cost has no estimated cost;
// - nothing here touches a dish's real status or any approved recipe.

import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import {
  convertPriceWithIngredientConversions,
  convertWithIngredientConversions,
  type UnitConversion,
} from "@/lib/restaurant/units";

export type EstimateUnit = "g" | "ml" | "unidad" | "oz" | "lb";
export const ESTIMATE_UNITS: readonly EstimateUnit[] = [
  "g",
  "ml",
  "unidad",
  "oz",
  "lb",
];
export const ESTIMATE_MODEL_NOTE = "Estimado por Milton";
export const MAX_ESTIMATE_LINES = 25;

export type EstimateConfidence = "alta" | "media" | "baja";

export interface EstimateLineRaw {
  raw_name: string;
  qty: number;
  unit: EstimateUnit;
  price_per_unit: number | null;
  price_unit: EstimateUnit | null;
  confidence: EstimateConfidence;
}

export interface ParsedEstimate {
  lines: EstimateLineRaw[];
  portion_note: string | null;
}

export interface EstimateDishInput {
  name: string;
  section: string | null;
  description: string | null;
  components: string[];
  menu_price: number | null;
  /** Average POS price when the dish is not on a read menu. */
  pos_price?: number | null;
  image_url: string | null;
}

export interface EstimateContext {
  country: string | null;
  currency: string;
  catalogNames: Array<{ name: string; unit: string }>;
}

/** Same normalization the catalog matching uses. */
export function nameKeyOf(name: string): string {
  return normalizeMatchName(name);
}

const MAX_QTY: Record<EstimateUnit, number> = {
  g: 5000,
  ml: 5000,
  unidad: 100,
  oz: 200,
  lb: 10,
};
const MAX_CATALOG_NAMES = 400;

export function estimatePrompt(
  dish: EstimateDishInput,
  ctx: EstimateContext
): { system: string; user: string } {
  const system = [
    "Eres un chef costeador de restaurantes. Estimas lo que lleva UN plato y cuánto cuesta cada ingrediente para el restaurante.",
    'Responde solo JSON: {"lines":[{"raw_name","qty","unit","price_per_unit","price_unit","confidence"}],"portion_note"}.',
    "raw_name: el ingrediente, en minúsculas y en singular. Si el catálogo del restaurante ya tiene ese ingrediente, usa exactamente el nombre del catálogo.",
    'qty: cantidad para UNA porción de restaurante realista, número mayor que 0. unit: "g", "ml", "unidad", "oz" o "lb".',
    "price_per_unit: precio típico de compra de un restaurante (proveedor o mayoreo, no de supermercado) por price_unit, en la moneda indicada y sin impuestos. price_unit: la misma lista de unidades.",
    "Si de verdad no puedes estimar el precio, price_per_unit y price_unit son null. Nunca pongas 0 ni negativos.",
    'confidence: "alta", "media" o "baja".',
    "portion_note: una frase corta sobre la porción supuesta, o null.",
    "Incluye solo lo que lleva el plato; no inventes ingredientes raros. Máximo 25 líneas.",
  ].join(" ");

  const country = ctx.country?.trim() || "país desconocido";
  const catalog = ctx.catalogNames
    .slice(0, MAX_CATALOG_NAMES)
    .map((c) => `${c.name} (${c.unit})`)
    .join("; ");
  const user = [
    `Plato: ${dish.name}`,
    dish.section ? `Sección: ${dish.section}` : null,
    dish.description ? `Descripción del menú: ${dish.description}` : null,
    dish.components.length > 0
      ? `Lleva (según el menú): ${dish.components.join(", ")}`
      : null,
    dish.menu_price != null
      ? `Precio en el menú: ${dish.menu_price} ${ctx.currency}`
      : dish.pos_price != null
        ? `Precio de venta promedio en el POS: ${dish.pos_price} ${ctx.currency}`
        : null,
    `País: ${country}. Moneda de los precios: ${ctx.currency}.`,
    catalog
      ? `Ingredientes del catálogo del restaurante (nombre y unidad): ${catalog}`
      : "El catálogo del restaurante está vacío.",
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
  return { system, user };
}

function positive(value: unknown, max: number): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n > 0 && n < max ? n : null;
}

function unitOf(value: unknown): EstimateUnit | null {
  if (typeof value !== "string") return null;
  const u = value.trim().toLowerCase();
  return (ESTIMATE_UNITS as readonly string[]).includes(u)
    ? (u as EstimateUnit)
    : null;
}

/** Strict: a bad line is dropped, never coerced. Null when no line is valid. */
export function parseEstimate(raw: unknown): ParsedEstimate | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as { lines?: unknown; portion_note?: unknown };
  if (!Array.isArray(obj.lines) || obj.lines.length > MAX_ESTIMATE_LINES) {
    return null;
  }
  const lines: EstimateLineRaw[] = [];
  for (const row of obj.lines) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name =
      typeof r.raw_name === "string"
        ? r.raw_name.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
    const unit = unitOf(r.unit);
    if (!name || !unit) continue;
    const qty = positive(r.qty, MAX_QTY[unit]);
    if (qty === null) continue;
    const priceUnit = unitOf(r.price_unit);
    const price = priceUnit ? positive(r.price_per_unit, 1_000_000) : null;
    const confidence: EstimateConfidence =
      r.confidence === "alta" || r.confidence === "media"
        ? r.confidence
        : "baja";
    lines.push({
      raw_name: name,
      qty,
      unit,
      price_per_unit: price,
      price_unit: price === null ? null : priceUnit,
      confidence,
    });
  }
  if (lines.length === 0) return null;
  const note =
    typeof obj.portion_note === "string"
      ? obj.portion_note.replace(/\s+/g, " ").trim().slice(0, 300)
      : "";
  return { lines, portion_note: note || null };
}

export interface EstimatedLine {
  raw_name: string;
  ingredient_id: string | null;
  qty: number;
  unit: EstimateUnit;
  price_source: "real" | "estimado" | null;
  unit_price: number | null;
  price_unit: string | null;
  price_estimate_id: string | null;
  line_cost: number | null;
  confidence: "alta" | "media" | "baja" | null;
}

/** Normalized unit cost of the latest REAL entry. */
export interface RealPrice {
  unit_cost: number;
  unit: string;
}

type PricedInput = EstimateLineRaw & { ingredient_id?: string | null };

function costOf(
  line: PricedInput,
  price: number,
  priceUnit: string,
  conversions: readonly UnitConversion[] | undefined
): number | null {
  if (!(price > 0) || !Number.isFinite(price)) return null;
  const qty = convertWithIngredientConversions(
    line.qty,
    line.unit,
    priceUnit,
    conversions
  );
  if (!qty.ok) return null;
  const cost = qty.value * price;
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

export function priceEstimateLines(
  lines: PricedInput[],
  realPriceOf: (line: PricedInput) => RealPrice | null,
  estimatedPriceOf: (
    nameKey: string
  ) => { unit_price: number; unit: string; id?: string | null } | null,
  opts: { conversions?: readonly UnitConversion[] } = {}
): EstimatedLine[] {
  return lines.map((line) => {
    const base = {
      raw_name: line.raw_name,
      ingredient_id: line.ingredient_id ?? null,
      qty: line.qty,
      unit: line.unit,
      confidence: line.confidence ?? null,
    };
    const none: EstimatedLine = {
      ...base,
      price_source: null,
      unit_price: null,
      price_unit: null,
      price_estimate_id: null,
      line_cost: null,
    };
    const real = realPriceOf(line);
    if (real && real.unit_cost > 0) {
      return {
        ...none,
        price_source: "real",
        unit_price: real.unit_cost,
        price_unit: real.unit,
        line_cost: costOf(line, real.unit_cost, real.unit, opts.conversions),
      };
    }
    const cached = estimatedPriceOf(nameKeyOf(line.raw_name));
    const own =
      line.price_per_unit != null && line.price_unit
        ? {
            unit_price: line.price_per_unit,
            unit: line.price_unit as string,
            id: null,
          }
        : null;
    const est = cached && cached.unit_price > 0 ? cached : own;
    if (est && est.unit_price > 0) {
      return {
        ...none,
        price_source: "estimado",
        unit_price: est.unit_price,
        price_unit: est.unit,
        price_estimate_id: est.id ?? null,
        line_cost: costOf(line, est.unit_price, est.unit, opts.conversions),
      };
    }
    return none;
  });
}

/** Null when there are no lines or ANY line has no cost: never a partial total. */
export function estimatedDishCost(
  lines: readonly EstimatedLine[]
): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const line of lines) {
    if (line.line_cost == null || !(line.line_cost > 0)) return null;
    total += line.line_cost;
  }
  return total > 0 && Number.isFinite(total) ? total : null;
}

/** Percent 0-100 (62.4). Null when the cost or the net price is unknown. */
export function estimatedMargin(
  estCost: number | null,
  avgNetPrice: number | null
): number | null {
  if (estCost == null || avgNetPrice == null) return null;
  if (!Number.isFinite(estCost) || !(avgNetPrice > 0)) return null;
  return ((avgNetPrice - estCost) / avgNetPrice) * 100;
}

export interface DishEstimateRow {
  menu_item_id: string;
  lines: EstimatedLine[];
  portion_note: string | null;
  est_cost: number | null;
  currency: string;
  model: string | null;
  used_as_draft_at: string | null;
  updated_at: string | null;
  odoo_product_id: number | null;
  location_id: string | null;
}

/**
 * Same rule as «Leer menú» (has-recipe.ts): only a plato with no recipe, or
 * one with a pending menu draft. A Confirmado link only says which POS product
 * this plato is; it does not block. An approved recipe with lines does.
 */
export function canEstimate(dish: {
  /** Ignored: a Confirmado link no longer blocks an estimate. */
  link_state?: string | null;
  /** The plato has a recipe by the one rule (not just a version row). */
  has_recipe: boolean;
  is_menu_draft: boolean;
  /** An approved version with lines is in force. */
  has_approved_version?: boolean;
}): { ok: true } | { ok: false; reason: "has_recipe" | "approved" } {
  if (dish.has_approved_version) return { ok: false, reason: "approved" };
  if (dish.has_recipe && !dish.is_menu_draft) {
    return { ok: false, reason: "has_recipe" };
  }
  return { ok: true };
}
