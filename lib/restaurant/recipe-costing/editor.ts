// Validar editor core (pure, no I/O).
//
// The recipe version's inputs are the recipe. The suggestion evidence on
// the POS link is a cache of what was shown to the person (and the home of
// lines that are not resolved to anything yet). Every edit goes to the
// inputs by id; the evidence is then rebuilt from them, so what the person
// sees, what the checklist reads and what gets approved can never drift.
//
// Costs always come from the costing engine against the catalog's latest
// price. Nothing here invents a number or creates an ingredient.

import {
  calculateMenuItemCost,
  getLatestIngredientCost,
  calculateComponentCost,
  type CostingData,
  type CostingRecipeInput,
} from "@/lib/restaurant/costing";
import { decideWorkbookCostMatch } from "@/lib/restaurant/cost-workbook/variance";
import { workbookVarianceFields } from "@/lib/restaurant/cost-workbook/variance";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { convertUnitPriceStr } from "@/lib/restaurant/units";

export const FLAG_PENDING_INGREDIENT = "pendiente_ingrediente";
export const FLAG_PENDING_COST = "pendiente_costo";
export const FLAG_PENDING_UNIT = "pendiente_unidad";
export const FLAG_OK = "ok";

export type EditorLineKind = "ingredient" | "component" | "unresolved";

export interface VersionInput {
  id: string;
  input_type: "ingredient" | "component";
  ingredient_id: string | null;
  component_id: string | null;
  quantity: number;
  unit: string;
}

export interface PriceMeta {
  /** Latest unit cost in the ingredient's own unit. */
  unit_cost: number;
  unit: string;
  date: string | null;
  /** "lista" | "recetas" | "manual" | "factura" | "importada" */
  source: string;
}

export interface PossibleMatch {
  kind: "ingredient" | "component";
  id: string;
  name: string;
}

export interface EditorLine {
  /** Input id, or `u:<n>` for an unresolved line. */
  key: string;
  input_id: string | null;
  kind: EditorLineKind;
  ingredient_id: string | null;
  component_id: string | null;
  /** Catalog name once resolved. */
  name: string | null;
  /** What the Excel (or the person) called it. */
  raw_name: string;
  source_row: number | null;
  qty: number;
  unit: string;
  /** Cost per line unit, or null when it cannot be computed. */
  unit_cost: number | null;
  amount: number | null;
  /** Latest catalog price for the item, for display. */
  price: PriceMeta | null;
  pending: boolean;
  flags: string[];
  reasons: string[];
  possible_match: PossibleMatch | null;
  /** Position in the cached evidence this line came from (null if added). */
  evidence_index: number | null;
  /** The written unit may be wrong: the person confirms one. */
  unit_question: { written: string; suggested: string } | null;
  /** Unit cost the Excel line showed (evidence only, never used as price). */
  excel_unit_cost: number | null;
}

export interface EvidenceLineIn {
  source_row: number | null;
  raw_name: string;
  ingredient_match: string | null;
  sub_recipe_match: string | null;
  qty: number;
  unit: string;
  pending: boolean;
  reasons: string[];
  flags: string[];
  input_id?: string | null;
  unit_question?: { written: string; suggested: string } | null;
  excel_unit_cost?: number | null;
}

function key(value: string): string {
  return normalizeMatchName(value);
}

// ---------------------------------------------------------------------------
// Costing a line with the engine (no re-implemented unit maths)
// ---------------------------------------------------------------------------

export interface LineCost {
  amount: number | null;
  unit_cost: number | null;
  reason: "no_price" | "unit" | "component" | null;
}

/** Cost one input by running it through the real engine on its own. */
export function costInput(
  data: CostingData,
  input: CostingRecipeInput
): LineCost {
  const menuId = "__line__";
  const recipeId = "__line_recipe__";
  const local: CostingData = {
    ...data,
    menuItemsById: new Map([
      [menuId, { id: menuId, name: "", selling_price: null, currency: null }],
    ]),
    menuRecipesByMenuItemId: new Map([
      [menuId, { id: recipeId, menu_item_id: menuId, status: "active" }],
    ]),
    menuRecipeInputsByRecipeId: new Map([[recipeId, [input]]]),
    menuRecipeVersionsByMenuItemId: undefined,
    menuRecipeVersionInputsByVersionId: undefined,
  };
  const result = calculateMenuItemCost(menuId, local);
  if (result.status === "complete" && result.cost !== null) {
    const unitCost =
      input.quantity > 0 ? result.cost / input.quantity : result.cost;
    return { amount: result.cost, unit_cost: unitCost, reason: null };
  }
  const issue = [result.status, ...result.issues.map((i) => i.kind)].join(" ");
  const reason = /no_cost_entries/.test(issue)
    ? "no_price"
    : /missing_unit_conversion/.test(issue)
      ? "unit"
      : input.input_type === "component"
        ? "component"
        : "no_price";
  return { amount: null, unit_cost: null, reason };
}

// ---------------------------------------------------------------------------
// Lines: inputs + unresolved evidence lines
// ---------------------------------------------------------------------------

export interface CatalogNames {
  ingredients: ReadonlyMap<string, string>; // id -> name
  components: ReadonlyMap<string, string>;
  priceOf(ingredientId: string): PriceMeta | null;
  /** Best guess for an unresolved name; never auto-applied. */
  suggest(rawName: string): PossibleMatch | null;
}

/**
 * Pair the evidence lines the person has already seen with the version's
 * inputs, so Excel names and rows survive. Inputs left over (added by the
 * person) become lines of their own. Evidence lines that are still pending
 * stay as unresolved lines.
 */
export function hydrateLines(input: {
  data: CostingData;
  evidenceLines: readonly EvidenceLineIn[];
  inputs: readonly VersionInput[];
  names: CatalogNames;
}): EditorLine[] {
  const { data, names } = input;
  const used = new Set<string>();
  const lines: EditorLine[] = [];

  const nameOfInput = (row: VersionInput): string | null =>
    row.input_type === "ingredient"
      ? (names.ingredients.get(row.ingredient_id ?? "") ?? null)
      : (names.components.get(row.component_id ?? "") ?? null);

  const toLine = (
    row: VersionInput,
    raw: {
      raw_name: string;
      source_row: number | null;
      reasons: string[];
      evidence_index: number | null;
      unit_question?: { written: string; suggested: string } | null;
      excel_unit_cost?: number | null;
    }
  ): EditorLine => {
    const cost = costInput(data, {
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
    });
    const question = raw.unit_question ?? null;
    const pending = cost.amount === null || question !== null;
    const flags = question
      ? [FLAG_PENDING_UNIT]
      : pending
        ? [cost.reason === "unit" ? FLAG_PENDING_UNIT : FLAG_PENDING_COST]
        : [FLAG_OK];
    return {
      key: row.id,
      input_id: row.id,
      kind: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      name: nameOfInput(row),
      raw_name: raw.raw_name,
      source_row: raw.source_row,
      qty: row.quantity,
      unit: row.unit,
      unit_cost: cost.unit_cost,
      amount: cost.amount,
      price:
        row.input_type === "ingredient" && row.ingredient_id
          ? names.priceOf(row.ingredient_id)
          : null,
      pending,
      flags,
      reasons: raw.reasons,
      possible_match: null,
      evidence_index: raw.evidence_index,
      unit_question: question,
      excel_unit_cost: raw.excel_unit_cost ?? null,
    };
  };

  const inputByKey = new Map<string, VersionInput[]>();
  for (const row of input.inputs) {
    const name = nameOfInput(row);
    if (!name) continue;
    const list = inputByKey.get(key(name)) ?? [];
    list.push(row);
    inputByKey.set(key(name), list);
  }

  let unresolvedIndex = 0;
  const findInput = (line: EvidenceLineIn): VersionInput | undefined => {
    if (line.input_id) {
      const byId = input.inputs.find((r) => r.id === line.input_id);
      if (byId) return byId;
    }
    const wanted = line.sub_recipe_match ?? line.ingredient_match;
    if (!wanted && line.pending) return undefined;
    const candidates = inputByKey.get(key(wanted ?? line.raw_name)) ?? [];
    return (
      candidates.find(
        (r) => !used.has(r.id) && Math.abs(r.quantity - line.qty) < 1e-9
      ) ?? candidates.find((r) => !used.has(r.id))
    );
  };

  for (const [evidenceIndex, line] of input.evidenceLines.entries()) {
    const row = findInput(line);
    if (row && !used.has(row.id)) {
      used.add(row.id);
      lines.push(
        toLine(row, {
          raw_name: line.raw_name,
          source_row: line.source_row,
          reasons: line.reasons,
          evidence_index: evidenceIndex,
          unit_question: line.unit_question ?? null,
          excel_unit_cost: line.excel_unit_cost ?? null,
        })
      );
      continue;
    }
    if (!line.pending) continue; // stale cache line with no input behind it
    // Not resolved to anything yet. Offer a match, never apply it.
    const matchName = line.sub_recipe_match ?? line.ingredient_match;
    lines.push({
      key: `u:${unresolvedIndex++}`,
      input_id: null,
      kind: "unresolved",
      ingredient_id: null,
      component_id: null,
      name: null,
      raw_name: line.raw_name,
      source_row: line.source_row,
      qty: line.qty,
      unit: line.unit,
      unit_cost: null,
      amount: null,
      price: null,
      pending: true,
      flags: [FLAG_PENDING_INGREDIENT],
      reasons: line.reasons,
      possible_match: names.suggest(matchName ?? line.raw_name),
      evidence_index: evidenceIndex,
      unit_question: null,
      excel_unit_cost: line.excel_unit_cost ?? null,
    });
  }

  // Inputs the person added (or that no evidence line claims).
  for (const row of input.inputs) {
    if (used.has(row.id)) continue;
    used.add(row.id);
    lines.push(
      toLine(row, {
        raw_name: nameOfInput(row) ?? "",
        source_row: null,
        reasons: [],
        evidence_index: null,
        unit_question: null,
        excel_unit_cost: null,
      })
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Evidence rebuild
// ---------------------------------------------------------------------------

export function evidenceLineFrom(line: EditorLine): Record<string, unknown> {
  return {
    source_row: line.source_row,
    raw_name: line.raw_name || line.name || "",
    ingredient_match: line.kind === "ingredient" ? line.name : null,
    sub_recipe_match: line.kind === "component" ? line.name : null,
    qty: line.qty,
    unit: line.unit,
    unit_cost: line.unit_cost,
    pending: line.pending,
    flags: line.flags,
    reasons: line.reasons,
    input_id: line.input_id,
    ingredient_id: line.ingredient_id,
    component_id: line.component_id,
    unit_question: line.unit_question,
    excel_unit_cost: line.excel_unit_cost,
  };
}

/** Rebuild the cached evidence from the editor's lines. */
export function rebuildEvidence(
  previous: Record<string, unknown>,
  lines: readonly EditorLine[]
): Record<string, unknown> {
  const anyPending = lines.some((line) => line.pending);
  const yieldRaw =
    previous.yield && typeof previous.yield === "object"
      ? (previous.yield as Record<string, unknown>)
      : {};
  const assumedYield =
    yieldRaw.source === "assumed" || yieldRaw.confirmed === false;

  let miltonCost: number | null = null;
  if (lines.length > 0 && !anyPending) {
    miltonCost = lines.reduce((sum, line) => sum + (line.amount ?? 0), 0);
  }
  const excel =
    typeof previous.excel_total === "number" ? previous.excel_total : null;
  const match =
    assumedYield || anyPending
      ? null
      : decideWorkbookCostMatch(excel, miltonCost);
  const variance = workbookVarianceFields(excel, miltonCost);

  return {
    ...previous,
    lines: lines.map(evidenceLineFrom),
    pending: anyPending || assumedYield,
    status: anyPending || assumedYield ? "borrador" : "lista_para_aprobar",
    milton_cost: miltonCost,
    excel_match: match,
    variance_amount: variance.workbook_variance_amount,
    variance_pct: variance.workbook_variance_pct,
  };
}

// ---------------------------------------------------------------------------
// Picker options
// ---------------------------------------------------------------------------

export interface PickerOption {
  kind: "ingredient" | "component";
  id: string;
  name: string;
  /** The unit the price is quoted in. */
  unit: string | null;
  unit_cost: number | null;
  price_date: string | null;
  price_source: string | null;
}

export function buildPickerOptions(input: {
  data: CostingData;
  priceOf(ingredientId: string): PriceMeta | null;
}): PickerOption[] {
  const out: PickerOption[] = [];
  for (const ingredient of input.data.ingredientsById.values()) {
    const price = input.priceOf(ingredient.id);
    out.push({
      kind: "ingredient",
      id: ingredient.id,
      name: ingredient.name,
      unit: price?.unit ?? ingredient.default_unit,
      unit_cost: price?.unit_cost ?? null,
      price_date: price?.date ?? null,
      price_source: price?.source ?? null,
    });
  }
  for (const component of input.data.componentsById.values()) {
    if (component.status === "archived") continue;
    const cost = calculateComponentCost(component.id, input.data);
    out.push({
      kind: "component",
      id: component.id,
      name: component.name,
      unit: cost.output_unit ?? component.output_unit,
      unit_cost: cost.status === "complete" ? cost.cost_per_output_unit : null,
      price_date: null,
      price_source: "preparación",
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Latest-price metadata for one ingredient, via the engine's own rule. */
export function latestPrice(
  data: CostingData,
  ingredientId: string,
  sourceOf: (entryId: string | undefined) => string
): PriceMeta | null {
  const latest = getLatestIngredientCost(ingredientId, data);
  if (latest.status !== "complete" || latest.unit_cost === null) return null;
  const entries = data.costEntriesByIngredientId.get(ingredientId) ?? [];
  const entry = entries
    .slice()
    .sort((a, b) =>
      (a.effective_date ?? a.cost_date) < (b.effective_date ?? b.cost_date)
        ? 1
        : -1
    )[0];
  return {
    unit_cost: latest.unit_cost,
    unit: latest.unit ?? "",
    date: latest.cost_date,
    source: sourceOf(entry?.id),
  };
}

/** A price expressed per another unit, or null when not convertible. */
export function priceInUnit(price: PriceMeta, unit: string): number | null {
  const converted = convertUnitPriceStr(price.unit_cost, price.unit, unit);
  return converted.ok ? converted.value : null;
}
