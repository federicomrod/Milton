// Holds only implausible per-unit prices. $0 (e.g. water) is fine.

import { convertUnitPrice, normalizeUnit } from "@/lib/restaurant/units";

/** $/kg above this when the recorded unit is gram is almost always a unit error. */
export const MAX_USD_PER_KG_IF_GRAM = 40;
/** Hard ceiling even for meat / oil / spices. */
export const MAX_USD_PER_KG = 150;

export function pricePerKg(unit: string, unitPrice: number): number | null {
  const normalized = normalizeUnit(unit);
  if (!normalized) return null;
  const converted = convertUnitPrice(unitPrice, normalized, "kg");
  return converted.ok ? converted.value : null;
}

export function typicalMassPriceScore(unit: string, unitPrice: number): number {
  const perKg = pricePerKg(unit, unitPrice);
  if (perKg === null) return 0.5;
  if (perKg <= 0) return 0;
  if (perKg >= 0.3 && perKg <= 40) return 1;
  if (perKg < 0.3) return perKg / 0.3;
  return Math.max(0, 40 / perKg);
}

export function implausiblePriceReason(
  _name: string,
  unit: string,
  unitPrice: number
): string | null {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return "implausible price (not a number)";
  }
  if (unitPrice === 0) return null;

  const normalized = normalizeUnit(unit);
  if (!normalized) return null;
  const perKg = pricePerKg(unit, unitPrice);
  if (perKg === null) return null;

  const rounded = perKg >= 10 ? perKg.toFixed(0) : perKg.toFixed(2);
  if (normalized === "g" && perKg > MAX_USD_PER_KG_IF_GRAM) {
    return `implausible price ($${unitPrice}/${unit} is about $${rounded}/kg)`;
  }
  if (perKg > MAX_USD_PER_KG) {
    return `implausible price ($${unitPrice}/${unit} is about $${rounded}/kg)`;
  }
  return null;
}
