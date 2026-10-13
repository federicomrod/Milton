import { textAt, numberAt, rowIsBlank } from "./cells";
import type { ColumnMapping, CostTabType } from "./types";

export const TOTAL_ROW_RE =
  /^(total|sub[\s-]?total|totales|subtotales|suma|costo\s+total|precio\s+por\s+libra|precio\s+por\s+onza|precio\s+de\s+venta|margen\s+de\s+contribuci)(\b|:|$)/i;

const HEADERISH_RE =
  /^(item|nombre|producto|ingrediente|ingredient|articulo|artículo|unidad(\s+detalle)?|unit|costo(\s+unitario)?|precio|cantidad|quantity|total(\s+costo)?|libra|onza|costo\s+restaurante|restaurante\s+los\s+ranchos)$/i;

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

export const PREVIOUS_DUPLICATE_REASON = "exact duplicate of a previous upload";
