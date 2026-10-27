// lib/restaurant/ingredientes-screen.ts
//
// Pure helpers for Menú › Ingredientes (R1-09b, A6/D7): price source,
// change vs the previous price, list order and a line's impact after a
// price edit. No I/O, so tests can pin the rules.

import { convertUnitPriceStr, normalizeUnit } from "@/lib/restaurant/units";

export type PriceSource = "excel" | "lista" | "factura" | "manual" | "telegram";

export const PRICE_SOURCE_LABEL: Record<PriceSource, string> = {
  excel: "Excel",
  lista: "lista de precios",
  factura: "factura",
  manual: "manual",
  telegram: "Telegram",
};

/**
 * Same rule as the editor store's sourceLabel (recetas = the Excel).
 * `priceUpdateLineIds` (from loadPriceUpdateRefs): an invoice_line entry that
 * came from a Telegram price update is «Telegram», not a «factura» (#313).
 */
export function priceSourceOf(
  entry: {
    source_type: string;
    source_id?: string | null;
    notes?: string | null;
  },
  priceUpdateLineIds?: ReadonlySet<string> | null
): PriceSource {
  if (entry.source_type === "manual") return "manual";
  if (entry.source_type === "invoice_line") {
    return entry.source_id && priceUpdateLineIds?.has(entry.source_id)
      ? "telegram"
      : "factura";
  }
  if (typeof entry.notes === "string" && entry.notes.startsWith("Receta")) {
    return "excel";
  }
  return "lista";
}

interface CostEntryLike {
  id: string;
  cost_date: string;
  created_at?: string | null;
  normalized_unit: string;
  normalized_unit_cost: number;
}

/**
 * The entry before `latest` with the same normalized unit (newest first),
 * so a change in unit never reads as a price change.
 */
export function previousSameUnitCost(
  entries: readonly CostEntryLike[],
  latest: CostEntryLike | null
): number | null {
  if (!latest) return null;
  const unit = normalizeUnit(latest.normalized_unit) ?? latest.normalized_unit;
  const key = (e: CostEntryLike) => `${e.cost_date}|${e.created_at ?? ""}`;
  const latestKey = key(latest);
  const prev = entries
    .filter((e) => e.id !== latest.id && key(e) <= latestKey)
    .filter(
      (e) => (normalizeUnit(e.normalized_unit) ?? e.normalized_unit) === unit
    )
    .filter((e) => Number.isFinite(e.normalized_unit_cost))
    .sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0))[0];
  return prev ? prev.normalized_unit_cost : null;
}

/** Percent change; null when either side is missing or the base is 0. */
export function priceChangePct(
  current: number | null,
  previous: number | null
): number | null {
  if (current === null || previous === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export type IngredientesFilter = "todos" | "falta_precio";

export function parseIngredientesFilter(
  raw: string | null | undefined
): IngredientesFilter {
  return raw === "falta_precio" ? "falta_precio" : "todos";
}

interface SortableRow {
  id: string;
  name: string;
  price: number | null;
  /** Net sales of the sold dishes that use it (0 = not used / not sold). */
  sold_net_sales: number;
}

/**
 * "Todos": alphabetical. "Falta precio": only rows without a price, the
 * ones used by the dishes that sell most first, then alphabetical.
 */
export function sortIngredientes<T extends SortableRow>(
  rows: readonly T[],
  filter: IngredientesFilter
): T[] {
  const byName = (a: T, b: T) =>
    a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  if (filter === "todos") return [...rows].sort(byName);
  return rows
    .filter((r) => r.price === null)
    .sort((a, b) => b.sold_net_sales - a.sold_net_sales || byName(a, b));
}

/** "$12.40", "12,40", "€ 12.4" → 12.4; anything else → null. */
export function parsePriceInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,-]/g, "").replace(/,(?=\d{1,4}$)/, ".");
  const plain = cleaned.replace(/,/g, "");
  if (plain === "" || !/^\d*\.?\d+$/.test(plain)) return null;
  const n = Number(plain);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A recipe line's cost after the ingredient's price changed. Converts the
 * new price into the line's unit; when that fails, scales the old amount
 * by the price ratio; otherwise null ("Sin precio", never $0).
 */
export function lineImpactAfterPrice(input: {
  qty: number;
  unit: string;
  oldAmount: number | null;
  oldPrice: number | null;
  newPrice: number;
  newPriceUnit: string;
}): number | null {
  const converted = convertUnitPriceStr(
    input.newPrice,
    input.newPriceUnit,
    input.unit
  );
  if (converted.ok && Number.isFinite(input.qty)) {
    return input.qty * converted.value;
  }
  if (
    input.oldAmount !== null &&
    input.oldPrice !== null &&
    input.oldPrice > 0
  ) {
    return input.oldAmount * (input.newPrice / input.oldPrice);
  }
  return null;
}
