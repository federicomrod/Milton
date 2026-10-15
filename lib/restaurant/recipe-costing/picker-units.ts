// lib/restaurant/recipe-costing/picker-units.ts
//
// Which unit the picker adds a line in (R1-10, picker bug a). The unit the
// person sees in the dropdown is the unit used, whether they clicked a row
// or kept the highlighted first match; changing the highlighted item
// resets it to a unit that makes sense for that item.

export const MASS_UNITS = ["oz", "lb", "g", "kg"];
export const VOLUME_UNITS = ["ml", "l", "gal"];

/** Units that make sense next to a price quoted in `unit`. */
export function unitsLike(unit: string | null | undefined): string[] {
  const key = (unit ?? "").toLowerCase();
  if (MASS_UNITS.includes(key)) return MASS_UNITS;
  if (VOLUME_UNITS.includes(key)) return VOLUME_UNITS;
  if (key === "portion") return ["portion"];
  return ["unit"];
}

/** The unit a line is added in for the highlighted option. */
export function pickerUnit(
  active: { kind: string; id: string; unit: string | null } | null,
  chosen: { key: string; unit: string } | null
): string {
  if (!active) return "unit";
  const allowed = unitsLike(active.unit);
  const key = `${active.kind}:${active.id}`;
  if (chosen && chosen.key === key && allowed.includes(chosen.unit)) {
    return chosen.unit;
  }
  return allowed[0] ?? "unit";
}
