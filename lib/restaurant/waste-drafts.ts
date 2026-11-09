// lib/restaurant/waste-drafts.ts
//
// #408 · what the AI is allowed to produce from a waste report: DRAFT lines
// (item, quantity, unit). Nothing here values anything or counts for a KPI; a
// manager confirms in Cocina first. Pure.

import { mapKitchenUnit } from "@/lib/restaurant/kitchen-units";

export interface WasteDraft {
  item: string;
  quantity: number | null;
  unit: string | null;
}

const MAX_ITEMS = 20;

/** Validates the model's JSON; anything unexpected is dropped, never guessed. */
export function parseWasteDrafts(raw: unknown): WasteDraft[] {
  const list =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items as unknown[])
      : [];
  const out: WasteDraft[] = [];
  for (const row of list.slice(0, MAX_ITEMS)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const item = typeof r.item === "string" ? r.item.trim().slice(0, 120) : "";
    if (!item) continue;
    const q = typeof r.quantity === "number" ? r.quantity : Number(r.quantity);
    const quantity = Number.isFinite(q) && q > 0 ? q : null;
    const unit =
      typeof r.unit === "string" ? (mapKitchenUnit(r.unit) ?? null) : null;
    out.push({ item, quantity, unit });
  }
  return out;
}

export const WASTE_DRAFT_PROMPT =
  "You read a restaurant kitchen waste report (Spanish, English or German) and list what was thrown away. " +
  'Answer ONLY JSON: {"items":[{"item":string,"quantity":number|null,"unit":string|null}]}. ' +
  "item is the product as written. quantity is null when the report gives no number; never invent one. " +
  "unit is kg, g, l, ml, unidad, lb, oz or null. No prices.";
