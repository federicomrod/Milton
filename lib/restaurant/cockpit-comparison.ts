// R1-16: what the Cockpit can be compared with. One list, used by Objetivos
// (the default), the API and the Cockpit control.

export const COMPARISONS = [
  "last_week",
  "last_month",
  "months_3",
  "months_6",
  "months_12",
] as const;

export type Comparison = (typeof COMPARISONS)[number];

export const DEFAULT_COMPARISON: Comparison = "months_6";

export const COMPARISON_LABEL: Record<Comparison, string> = {
  last_week: "Semana pasada",
  last_month: "Mes pasado",
  months_3: "Últimos 3 meses",
  months_6: "Últimos 6 meses",
  months_12: "Últimos 12 meses",
};

/** Short form for chips: "vs 6 meses". */
export const COMPARISON_SHORT: Record<Comparison, string> = {
  last_week: "semana pasada",
  last_month: "mes pasado",
  months_3: "3 meses",
  months_6: "6 meses",
  months_12: "12 meses",
};

export function parseComparison(value: unknown): Comparison {
  return (COMPARISONS as readonly string[]).includes(value as string)
    ? (value as Comparison)
    : DEFAULT_COMPARISON;
}

/** Months of the trailing baseline (3, 6 or 12), or null for week/month shifts. */
export function trailingMonths(c: Comparison): number | null {
  return c === "months_3"
    ? 3
    : c === "months_6"
      ? 6
      : c === "months_12"
        ? 12
        : null;
}
