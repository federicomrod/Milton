// lib/restaurant/ui/heat-scale.ts
//
// The ONE colour scale of every heatmap (Ventas › hora × día, Cockpit): brand
// blue #1B40C8 from light to dark. Intensity is 0–1 (the cell's value over the
// maximum); `null` / nothing sold is the neutral grey. No orange: orange means
// «warning / pending» in this product, never "more sales".

/** A cell with no value (or no sales). */
export const HEAT_EMPTY = "#f2f3f6";

const clamp01 = (n: number) =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

/** 0 → the lightest blue, 1 → the darkest. `null` → the empty grey. */
export function heatColor(intensity: number | null | undefined): string {
  if (intensity === null || intensity === undefined) return HEAT_EMPTY;
  const a = 0.08 + clamp01(intensity) * 0.84;
  return `rgba(27,64,200,${a.toFixed(2)})`;
}

/** The text colour that reads on `heatColor(intensity)`. */
export function heatText(intensity: number): string {
  return clamp01(intensity) > 0.55 ? "#ffffff" : "#151c2c";
}
