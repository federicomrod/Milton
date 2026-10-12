import { workbookMatchLabel } from "@/lib/restaurant/cost-workbook/copy";
import type { SuggestionEvidenceView, SuggestionLineView } from "./evidence";
import { formatMoneyEs, formatPctLabel, lineCostDisplay } from "./format";
import { excelTabSummary } from "./copy";

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

export interface ReviewTabView {
  tab: string;
  summary: string;
  cuadra_con_excel: boolean;
  item_count: number;
  items: ReviewItemView[];
}

export function isUncertainEvidence(evidence: SuggestionEvidenceView): boolean {
  if (evidence.pending) return true;
  if (evidence.excel_match === "mismatch") return true;
  if (evidence.yield.source === "assumed") return true;
  if (evidence.status === "borrador") return true;
  return evidence.lines.some((line) => line.pending);
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
    unit_cost_label:
      cost.amount != null && line.unit
        ? `${cost.label} / ${line.unit}`
        : cost.label,
    aporte,
    aporte_label: aporte != null ? formatMoneyEs(aporte, currency) : cost.label,
    dish_pct: dishPct,
    dish_pct_label: dishPct != null ? formatPctLabel(dishPct) : "—",
    flags: line.flags,
    reasons: line.reasons,
    is_sub_recipe: Boolean(line.sub_recipe_match),
  };
}

export function groupUncertainByTab(
  items: readonly ReviewItemView[]
): ReviewTabView[] {
  const byTab = new Map<string, ReviewItemView[]>();
  for (const item of items) {
    const tab = item.tab.trim() || "Sin pestaña";
    const list = byTab.get(tab) ?? [];
    list.push(item);
    byTab.set(tab, list);
  }
  return [...byTab.entries()]
    .map(([tab, tabItems]) => {
      const pending = tabItems.some((item) => item.pending);
      const reasons = tabItems.flatMap((item) =>
        item.reason ? [item.reason] : []
      );
      const excelMatch = tabItems.every((item) => item.excel_match === "match")
        ? "match"
        : tabItems.some((item) => item.excel_match === "mismatch")
          ? "mismatch"
          : null;
      const cuadra = !pending && excelMatch === "match";
      return {
        tab,
        summary: cuadra
          ? workbookMatchLabel("es")
          : excelTabSummary({
              excel_match: excelMatch,
              pending,
              reasons,
            }),
        cuadra_con_excel: cuadra,
        item_count: tabItems.length,
        items: tabItems,
      };
    })
    .sort((a, b) => a.tab.localeCompare(b.tab, "es"));
}

export function applyInlineLineFix(
  line: SuggestionLineView,
  fix: {
    unit?: string;
    quantity?: number;
    unit_cost?: number;
  }
): SuggestionLineView {
  const next: SuggestionLineView = { ...line, flags: [...line.flags] };
  if (typeof fix.unit === "string" && fix.unit.trim()) {
    next.unit = fix.unit.trim();
    next.flags = next.flags.filter((flag) => flag !== "pendiente_unidad");
    next.reasons = next.reasons.filter(
      (reason) => !/unidad|unit/i.test(reason)
    );
  }
  if (
    typeof fix.quantity === "number" &&
    Number.isFinite(fix.quantity) &&
    fix.quantity > 0
  ) {
    next.qty = fix.quantity;
  }
  if (
    typeof fix.unit_cost === "number" &&
    Number.isFinite(fix.unit_cost) &&
    fix.unit_cost > 0
  ) {
    next.unit_cost = fix.unit_cost;
    next.flags = next.flags.filter((flag) => flag !== "pendiente_costo");
    next.reasons = next.reasons.filter(
      (reason) => !/costo|precio|No puse \$0/i.test(reason)
    );
  }
  next.pending =
    next.flags.includes("pendiente_unidad") ||
    next.flags.includes("pendiente_costo") ||
    next.flags.includes("pendiente_sub_receta") ||
    next.unit_cost == null;
  if (!next.pending) {
    next.flags = next.flags.filter((flag) => flag.startsWith("pendiente_"));
    if (!next.flags.includes("ok")) next.flags.push("ok");
  }
  return next;
}
