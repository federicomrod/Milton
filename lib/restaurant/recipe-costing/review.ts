import type { SuggestionEvidenceView, SuggestionLineView } from "./evidence";
import { formatMoneyEs, formatPctLabel, lineCostDisplay } from "./format";

export interface ReviewLineView {
  source_row: number | null;
  raw_name: string;
  qty: number;
  unit: string;
  pending: boolean;
  cost_label: string;
  unit_cost: number | null;
  unit_cost_label: string;
  aporte: number | null;
  aporte_label: string;
  dish_pct: number | null;
  dish_pct_label: string;
  flags: string[];
  reasons: string[];
  is_sub_recipe: boolean;
  source_note: string | null;
}

export interface ReviewItemView {
  odoo_product_id: number;
  odoo_name: string;
  menu_item_id: string | null;
  recipe_version_id: string | null;
  tab: string;
  block_name: string | null;
  filename: string | null;
  pending: boolean;
  excel_match: "match" | "mismatch" | null;
  reason: string;
  milton_cost_label: string | null;
  excel_total_label: string | null;
  lines: ReviewLineView[];
}

export function isUncertainEvidence(evidence: SuggestionEvidenceView): boolean {
  if (evidence.pending) return true;
  if (evidence.excel_match === "mismatch") return true;
  if (evidence.yield.source === "assumed") return true;
  if (evidence.status === "borrador") return true;
  return evidence.lines.some((line) => line.pending);
}

function purchaseUnitCostLabel(
  label: string,
  amount: number | null,
  unit: string
): string {
  if (amount == null || !unit) return label;
  const folded = unit
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  if (folded === "g" || folded === "gr" || folded.startsWith("gramo")) {
    return `${formatMoneyEs(amount * 1000)} / kg`;
  }
  if (folded === "ml") {
    return `${formatMoneyEs(amount * 1000)} / L`;
  }
  if (folded === "unidad" || folded === "u" || folded.startsWith("unidad")) {
    return `${label} / u`;
  }
  if (folded.startsWith("porcion")) {
    return `${label} / porción`;
  }
  return `${label} / ${unit}`;
}

export function toReviewLine(
  line: SuggestionLineView,
  currency?: string,
  portionCost?: number | null
): ReviewLineView {
  const cost = lineCostDisplay({
    pending: line.pending,
    unit_cost: line.unit_cost,
    currency,
  });
  const aporte =
    !line.pending && cost.amount != null && line.qty > 0
      ? Math.round(line.qty * cost.amount * 100) / 100
      : null;
  const dishPct =
    aporte != null && portionCost != null && portionCost > 0
      ? Math.round((aporte / portionCost) * 100)
      : null;
  return {
    source_row: line.source_row,
    raw_name: line.raw_name,
    qty: line.qty,
    unit: line.unit,
    pending: line.pending,
    cost_label: cost.label,
    unit_cost: cost.amount,
    unit_cost_label: purchaseUnitCostLabel(cost.label, cost.amount, line.unit),
    aporte,
    aporte_label: aporte != null ? formatMoneyEs(aporte, currency) : cost.label,
    dish_pct: dishPct,
    dish_pct_label: dishPct != null ? formatPctLabel(dishPct) : "—",
    flags: line.flags,
    reasons: line.reasons,
    is_sub_recipe: Boolean(line.sub_recipe_match),
    source_note: line.sub_recipe_match
      ? "Preparación"
      : (line.reasons.find((reason) =>
          /compra|proveedor|oct|sep|nov|dic/i.test(reason)
        ) ?? null),
  };
}
