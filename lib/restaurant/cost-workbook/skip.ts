import { textAt, numberAt, rowIsBlank } from "./cells";
import type {
  ColumnMapping,
  CostTabType,
  SkipCandidate,
  SkipReasonCount,
} from "./types";

export const TOTAL_ROW_RE =
  /^(total|sub[\s-]?total|totales|subtotales|suma)(\b|:|$)/i;

const HEADERISH_RE =
  /^(item|nombre|producto|ingrediente|ingredient|articulo|artículo|unidad|unit|costo|precio|cantidad|quantity|total|libra|onza)$/i;

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
