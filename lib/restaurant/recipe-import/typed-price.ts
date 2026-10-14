// lib/restaurant/recipe-import/typed-price.ts
//
// A price a person typed on a recipe line survives a re-import of the
// same file (R1-10, picker bug b). When the file now writes the line in
// another unit of the same kind (oz → lb), the price is converted to it;
// it is never dropped silently. A unit it cannot convert to (lb → unit)
// is reported so the screen can say which price to type again.

import { convertUnitPriceStr } from "@/lib/restaurant/units";

export type CarriedPrice =
  | { kind: "kept"; unit_cost: number }
  | { kind: "converted"; unit_cost: number }
  | { kind: "not_carried" };

export function carryTypedPrice(
  typed: { unit: string; unit_cost: number },
  incomingUnit: string
): CarriedPrice {
  if (typed.unit === incomingUnit) {
    return { kind: "kept", unit_cost: typed.unit_cost };
  }
  const converted = convertUnitPriceStr(
    typed.unit_cost,
    typed.unit,
    incomingUnit
  );
  if (converted.ok && Number.isFinite(converted.value) && converted.value > 0) {
    return { kind: "converted", unit_cost: converted.value };
  }
  return { kind: "not_carried" };
}
