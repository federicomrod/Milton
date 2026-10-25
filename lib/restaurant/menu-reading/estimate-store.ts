// «Estimar con Milton»: the ONLY reads of the estimate tables
// (restaurant_dish_estimates, ingredient_price_estimates, migration 062).
//
// Estimates are an overlay for the screens that show them (Platos, the menu
// area, the editor). dish-economics, the cockpit, the briefing, Ask Milton,
// profitability and Costos must never import this module: a test enforces it.
//
// Never throws. A missing table (Postgres 42P01 / PostgREST PGRST205) is
// `unavailable: true`, so the app behaves exactly as before migration 062.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DishEstimateRow, EstimatedLine } from "./estimate";

export const DISH_ESTIMATES_TABLE = "restaurant_dish_estimates";
export const PRICE_ESTIMATES_TABLE = "ingredient_price_estimates";

export interface PriceEstimateRow {
  id: string;
  ingredient_id: string | null;
  name_key: string;
  unit: string;
  unit_price: number;
  currency: string | null;
  country: string | null;
  model: string | null;
  rationale: string | null;
  created_at: string | null;
}

export type EstimateRead<T> =
  | { ok: true; rows: T[] }
  | { ok: false; unavailable: boolean };

interface ErrorLike {
  code?: string;
  message?: string;
  details?: string;
}

/** True when the error says the estimate tables are not there yet. */
export function isMissingEstimateTable(
  error: ErrorLike | null | undefined
): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    (text.includes("relation") && text.includes("does not exist")) ||
    (text.includes("could not find the table") &&
      (text.includes(DISH_ESTIMATES_TABLE) ||
        text.includes(PRICE_ESTIMATES_TABLE)))
  );
}

function num(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function linesOf(value: unknown): EstimatedLine[] {
  if (!Array.isArray(value)) return [];
  const out: EstimatedLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = str(r.raw_name);
    const qty = num(r.qty);
    const unit = str(r.unit);
    if (!name || qty === null || !unit) continue;
    const cost = num(r.line_cost);
    const price = num(r.unit_price);
    out.push({
      raw_name: name,
      ingredient_id: str(r.ingredient_id),
      qty,
      unit: unit as EstimatedLine["unit"],
      price_source:
        r.price_source === "real" || r.price_source === "estimado"
          ? r.price_source
          : null,
      unit_price: price !== null && price > 0 ? price : null,
      price_unit: str(r.price_unit),
      price_estimate_id: str(r.price_estimate_id),
      line_cost: cost !== null && cost > 0 ? cost : null,
      confidence:
        r.confidence === "alta" ||
        r.confidence === "media" ||
        r.confidence === "baja"
          ? r.confidence
          : null,
    });
  }
  return out;
}

export function dishEstimateFromRow(
  row: Record<string, unknown>
): DishEstimateRow | null {
  const menuItemId = str(row.menu_item_id);
  if (!menuItemId) return null;
  const cost = num(row.est_cost);
  return {
    menu_item_id: menuItemId,
    lines: linesOf(row.lines),
    portion_note: str(row.portion_note),
    // Sin precio is NULL, never 0.
    est_cost: cost !== null && cost > 0 ? cost : null,
    currency: str(row.currency) ?? "USD",
    model: str(row.model),
    used_as_draft_at: str(row.used_as_draft_at),
    updated_at: str(row.updated_at),
    odoo_product_id: num(row.odoo_product_id),
    location_id: str(row.location_id),
  };
}

const DISH_SELECT =
  "menu_item_id, location_id, odoo_product_id, lines, portion_note, est_cost, currency, model, used_as_draft_at, updated_at";
const PRICE_SELECT =
  "id, ingredient_id, name_key, unit, unit_price, currency, country, model, rationale, created_at";
const PAGE = 1000;
const MAX_PAGES = 20;

/** Every row of a company-scoped table, one page at a time. */
async function readAll(
  supabase: SupabaseClient,
  table: string,
  select: string,
  companyId: string
): Promise<
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; unavailable: boolean }
> {
  try {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from(table)
        .select(select)
        .eq("company_id", companyId)
        .order("id")
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) {
        return { ok: false, unavailable: isMissingEstimateTable(error) };
      }
      const got = (data ?? []) as unknown as Record<string, unknown>[];
      rows.push(...got);
      if (got.length < PAGE) break;
    }
    return { ok: true, rows };
  } catch (err) {
    return {
      ok: false,
      unavailable: isMissingEstimateTable(
        err && typeof err === "object" ? (err as ErrorLike) : null
      ),
    };
  }
}

export async function loadDishEstimates(
  supabase: SupabaseClient,
  companyId: string
): Promise<EstimateRead<DishEstimateRow>> {
  const read = await readAll(
    supabase,
    DISH_ESTIMATES_TABLE,
    DISH_SELECT,
    companyId
  );
  if (!read.ok) return read;
  return {
    ok: true,
    rows: read.rows
      .map(dishEstimateFromRow)
      .filter((row): row is DishEstimateRow => row !== null),
  };
}

export async function loadPriceEstimates(
  supabase: SupabaseClient,
  companyId: string
): Promise<EstimateRead<PriceEstimateRow>> {
  const read = await readAll(
    supabase,
    PRICE_ESTIMATES_TABLE,
    PRICE_SELECT,
    companyId
  );
  if (!read.ok) return read;
  const rows: PriceEstimateRow[] = [];
  for (const r of read.rows) {
    const price = num(r.unit_price);
    const key = str(r.name_key);
    const unit = str(r.unit);
    // A price is positive or it is not a price.
    if (!key || !unit || price === null || !(price > 0)) continue;
    rows.push({
      id: String(r.id),
      ingredient_id: str(r.ingredient_id),
      name_key: key,
      unit,
      unit_price: price,
      currency: str(r.currency),
      country: str(r.country),
      model: str(r.model),
      rationale: str(r.rationale),
      created_at: str(r.created_at),
    });
  }
  return { ok: true, rows };
}
