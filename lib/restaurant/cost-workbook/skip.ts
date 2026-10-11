import { t, type PreferredLanguage } from "@/lib/restaurant/language";
import { textAt, numberAt, rowIsBlank } from "./cells";
import type {
  ColumnMapping,
  CostTabType,
  SkipCandidate,
  SkipReasonCount,
} from "./types";

export const TOTAL_ROW_RE =
  /^(total|sub[\s-]?total|totales|subtotales|suma|costo\s+total|precio\s+por\s+libra|precio\s+por\s+onza|precio\s+de\s+venta|margen\s+de\s+contribuci)(\b|:|$)/i;

const HEADERISH_RE =
  /^(item|nombre|producto|ingrediente|ingredient|articulo|artículo|unidad(\s+detalle)?|unit|costo(\s+unitario)?|precio|cantidad|quantity|total(\s+costo)?|libra|onza|costo\s+restaurante|restaurante\s+los\s+ranchos)$/i;

const NO_PRICE_REASONS = new Set(["Missing unit price", "Missing cost"]);

export function isNoPriceReviewReason(reason: string): boolean {
  return NO_PRICE_REASONS.has(reason);
}

export function skipReasonForWorkbookRow(
  tabType: CostTabType,
  row: Record<string, unknown>,
  mapping: ColumnMapping
): string | null {
  if (tabType === "ignore") return "blank";
  if (rowIsBlank(row)) return "blank";

  const name =
    textAt(row, mapping, "ingredient_name") ??
    textAt(row, mapping, "recipe_name");
  if (!name) return "blank";
  if (TOTAL_ROW_RE.test(name.trim()) || HEADERISH_RE.test(name.trim())) {
    return "header/total row";
  }

  if (tabType === "price_list") {
    const priceLb = numberAt(row, mapping, "price_per_lb");
    const priceOz = numberAt(row, mapping, "price_per_oz");
    const priceUnit = numberAt(row, mapping, "price_per_unit");
    const hasPrice =
      (priceLb !== null && priceLb > 0) ||
      (priceOz !== null && priceOz > 0) ||
      (priceUnit !== null && priceUnit > 0);
    if (!hasPrice) return "no price";
  }

  return null;
}

export function groupSkipReasons(skips: SkipCandidate[]): SkipReasonCount[] {
  const counts = new Map<string, number>();
  for (const skip of skips) {
    counts.set(skip.reason, (counts.get(skip.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function formatSkipSummary(reasons: SkipReasonCount[]): string {
  if (reasons.length === 0) return "";
  return reasons
    .map((row) =>
      row.count === 1 ? `1 ${row.reason}` : `${row.count} ${row.reason}`
    )
    .join(", ");
}

export const PREVIOUS_DUPLICATE_REASON = "exact duplicate of a previous upload";

const BLANK_OR_TITLE_REASONS = new Set(["blank", "header/total row"]);

export interface SkippedRowBreakdown {
  previous_duplicates: number;
  blank_or_title: number;
  other: number;
}

export function summarizeSkippedRows(
  skips: SkipCandidate[]
): SkippedRowBreakdown {
  const breakdown: SkippedRowBreakdown = {
    previous_duplicates: 0,
    blank_or_title: 0,
    other: 0,
  };
  for (const skip of skips) {
    if (skip.reason === PREVIOUS_DUPLICATE_REASON) {
      breakdown.previous_duplicates += 1;
    } else if (BLANK_OR_TITLE_REASONS.has(skip.reason)) {
      breakdown.blank_or_title += 1;
    } else {
      breakdown.other += 1;
    }
  }
  return breakdown;
}

export function formatSkipBreakdownSentence(
  total: number,
  breakdown: SkippedRowBreakdown,
  lang: PreferredLanguage = "en"
): string {
  if (total === 0) return "";
  const noun = t(
    lang,
    total === 1 ? "row" : "rows",
    total === 1 ? "fila" : "filas"
  );
  const dup = t(
    lang,
    breakdown.previous_duplicates === 1
      ? "1 was an exact duplicate of a previous upload"
      : `${breakdown.previous_duplicates} were exact duplicates of a previous upload`,
    breakdown.previous_duplicates === 1
      ? "1 era un duplicado exacto de una carga anterior"
      : `${breakdown.previous_duplicates} eran duplicados exactos de una carga anterior`
  );
  const blank = t(
    lang,
    breakdown.blank_or_title === 1
      ? "1 was a blank or title row"
      : `${breakdown.blank_or_title} were blank or title rows`,
    breakdown.blank_or_title === 1
      ? "1 era una fila en blanco o de título"
      : `${breakdown.blank_or_title} eran filas en blanco o de título`
  );
  return t(
    lang,
    `Of the ${total} skipped ${noun}, ${dup} and ${blank}.`,
    total === 1
      ? `De la ${total} fila omitida, ${dup} y ${blank}.`
      : `De las ${total} filas omitidas, ${dup} y ${blank}.`
  );
}
