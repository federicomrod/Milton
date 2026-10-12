// Deterministic checks on an AI / heuristic recipe proposal.
// The model never does these. Invalid units, missing costs, assumed
// yields and ambiguous sub-recipes stay Pendiente. Never invent $0.

import { nameKey } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  convertUnitPriceStr,
  normalizeUnit,
  resolveUnitCell,
} from "@/lib/restaurant/units";
import { resolveRecipeLineUnit } from "./portion-unit";
import { decideWorkbookCostMatch, workbookVarianceFields } from "./variance";
import {
  assumedYieldReason,
  missingCostPendingReason,
  unitLooksLikeNameReason,
  unknownUnitReason,
} from "./copy";
import type { GroupedRecipe } from "./types";
import type { RecipeProposal, RecipeProposalLine } from "./propose-recipe";

export const LINE_FLAG_PENDING_UNIT = "pendiente_unidad";
export const LINE_FLAG_PENDING_COST = "pendiente_costo";
export const LINE_FLAG_PENDING_SUB = "pendiente_sub_receta";
export const LINE_FLAG_OK = "ok";

export type SuggestionStatus = "borrador" | "lista_para_aprobar";

export interface CatalogIngredient {
  id: string;
  name: string;
  current_unit_cost?: number | null;
  default_unit?: string | null;
}

export interface CatalogSubRecipe {
  id?: string;
  name: string;
  price_per_lb?: number | null;
  price_per_oz?: number | null;
  output_unit?: string | null;
  yield_assumed?: boolean;
}

export interface CheckedProposalLine extends RecipeProposalLine {
  pending: boolean;
  reasons: string[];
  resolved_unit: string | null;
  resolved_unit_cost: number | null;
}

export interface CheckedRecipeProposal {
  proposal: RecipeProposal;
  lines: CheckedProposalLine[];
  status: SuggestionStatus;
  pending: boolean;
  reasons: string[];
  milton_cost: number | null;
  excel_match: "match" | "mismatch" | null;
  variance_amount: number | null;
  variance_pct: number | null;
}

function isMassUnit(unit: string): "lb" | "oz" | null {
  const canonical = normalizeUnit(unit);
  if (canonical === "lb") return "lb";
  if (canonical === "oz") return "oz";
  return null;
}

function looksLikeIngredientName(unitRaw: string): boolean {
  const trimmed = unitRaw.trim();
  if (!trimmed) return false;
  if (normalizeUnit(trimmed)) return false;
  const resolved = resolveUnitCell(trimmed, "es");
  if (resolved.ok) return false;
  return /[a-záéíóúñ]/i.test(trimmed) && !/\d/.test(trimmed);
}

export function exactNameMatches<T extends { name: string }>(
  rawName: string,
  items: readonly T[]
): T[] {
  const key = nameKey(rawName);
  if (!key) return [];
  return items.filter((item) => nameKey(item.name) === key);
}

export function confirmedMassPrice(
  sub: CatalogSubRecipe,
  mass: "lb" | "oz"
): number | null {
  if (sub.yield_assumed) return null;
  if (mass === "lb") {
    return sub.price_per_lb != null && sub.price_per_lb > 0
      ? sub.price_per_lb
      : null;
  }
  if (sub.price_per_oz != null && sub.price_per_oz > 0) return sub.price_per_oz;
  if (sub.price_per_lb != null && sub.price_per_lb > 0) {
    const converted = convertUnitPriceStr(sub.price_per_lb, "lb", "oz");
    return converted.ok && converted.value > 0 ? converted.value : null;
  }
  return null;
}

export function catalogFromBlocks(
  blocks: readonly GroupedRecipe[]
): CatalogSubRecipe[] {
  return blocks
    .filter((block) => block.kind === "sub_recipe")
    .map((block) => ({
      name: block.name,
      price_per_lb: block.price_per_lb ?? null,
      price_per_oz: block.price_per_oz ?? null,
      output_unit: block.output_unit ?? null,
      yield_assumed: Boolean(block.yield_assumed),
    }));
}

export function checkProposalLine(input: {
  line: RecipeProposalLine;
  ingredients: readonly CatalogIngredient[];
  subRecipes: readonly CatalogSubRecipe[];
  lang?: PreferredLanguage;
}): CheckedProposalLine {
  const lang = input.lang ?? "es";
  const reasons: string[] = [];
  let pending = false;
  let ingredientMatch: string | null = null;
  let subRecipeMatch: string | null = null;
  let resolvedUnit: string | null = null;
  let resolvedUnitCost: number | null = null;

  const mass = isMassUnit(input.line.unit);
  const exactSubs = exactNameMatches(input.line.raw_name, input.subRecipes);
  if (exactSubs.length > 1) {
    pending = true;
    reasons.push(
      `esta línea quedó pendiente: ${input.line.raw_name} coincide con más de una sub-receta`
    );
  } else if (exactSubs.length === 1) {
    const sub = exactSubs[0]!;
    if (mass) {
      const price = confirmedMassPrice(sub, mass);
      if (price == null) {
        pending = true;
        reasons.push(
          `esta línea quedó pendiente: ${sub.name} no tiene un precio confirmado por ${mass === "lb" ? "libra" : "onza"}`
        );
      } else {
        subRecipeMatch = sub.name;
        resolvedUnit = mass;
        resolvedUnitCost = price;
      }
    } else {
      const unit = resolveRecipeLineUnit({
        unitRaw: input.line.unit,
        ingredientName: input.line.raw_name,
        knownSubRecipeNames: input.subRecipes.map((row) => row.name),
        lang,
      });
      if (!unit.ok) {
        pending = true;
        reasons.push(unit.reason);
      } else {
        subRecipeMatch = sub.name;
        resolvedUnit = unit.canonical;
      }
    }
  }

  if (!subRecipeMatch) {
    const unit = resolveRecipeLineUnit({
      unitRaw: input.line.unit,
      ingredientName: input.line.raw_name,
      knownSubRecipeNames: input.subRecipes.map((row) => row.name),
      lang,
    });
    if (!unit.ok) {
      pending = true;
      if (looksLikeIngredientName(input.line.unit)) {
        reasons.push(unitLooksLikeNameReason(lang, input.line.unit));
      } else {
        reasons.push(unknownUnitReason(lang, input.line.unit));
      }
    } else {
      resolvedUnit = unit.canonical;
    }

    const exactIngredients = exactNameMatches(
      input.line.raw_name,
      input.ingredients
    );
    if (exactIngredients.length === 1) {
      ingredientMatch = exactIngredients[0]!.name;
      const catalogCost = exactIngredients[0]!.current_unit_cost;
      const fromUnit = exactIngredients[0]!.default_unit ?? resolvedUnit;
      if (
        resolvedUnitCost == null &&
        catalogCost != null &&
        catalogCost > 0 &&
        fromUnit &&
        resolvedUnit
      ) {
        if (
          nameKey(fromUnit) === nameKey(resolvedUnit) ||
          fromUnit === resolvedUnit
        ) {
          resolvedUnitCost = catalogCost;
        } else {
          const converted = convertUnitPriceStr(
            catalogCost,
            fromUnit,
            resolvedUnit
          );
          if (converted.ok && converted.value > 0) {
            resolvedUnitCost = converted.value;
          }
        }
      }
    }
  }

  const excelCost =
    input.line.unit_cost != null && input.line.unit_cost > 0
      ? input.line.unit_cost
      : null;
  if (excelCost != null) resolvedUnitCost = excelCost;

  if (resolvedUnitCost == null || resolvedUnitCost <= 0) {
    pending = true;
    resolvedUnitCost = null;
    reasons.push(missingCostPendingReason(lang, input.line.raw_name));
  }

  const flags = [...input.line.flags];
  if (pending) {
    if (
      reasons.some(
        (reason) => reason.includes("unidad") || reason.includes("unit")
      )
    ) {
      flags.push(LINE_FLAG_PENDING_UNIT);
    }
    if (reasons.some((reason) => /costo|cost/i.test(reason))) {
      flags.push(LINE_FLAG_PENDING_COST);
    }
    if (
      !flags.includes(LINE_FLAG_PENDING_UNIT) &&
      !flags.includes(LINE_FLAG_PENDING_COST)
    ) {
      flags.push(LINE_FLAG_PENDING_SUB);
    }
  } else {
    flags.push(LINE_FLAG_OK);
  }

  return {
    ...input.line,
    ingredient_match: ingredientMatch,
    sub_recipe_match: subRecipeMatch,
    flags: [...new Set(flags)],
    pending,
    reasons,
    resolved_unit: resolvedUnit,
    resolved_unit_cost: resolvedUnitCost,
  };
}

export function checkRecipeProposal(input: {
  proposal: RecipeProposal;
  ingredients: readonly CatalogIngredient[];
  subRecipes: readonly CatalogSubRecipe[];
  lang?: PreferredLanguage;
}): CheckedRecipeProposal {
  const lang = input.lang ?? "es";
  const lines = input.proposal.lines.map((line) =>
    checkProposalLine({
      line,
      ingredients: input.ingredients,
      subRecipes: input.subRecipes,
      lang,
    })
  );
  const reasons = [...new Set(lines.flatMap((line) => line.reasons))];
  const assumedYield = input.proposal.yield.source === "assumed";
  if (assumedYield) {
    reasons.push(assumedYieldReason(lang));
  }
  const anyPending = lines.some((line) => line.pending) || assumedYield;

  let miltonCost: number | null = null;
  if (!lines.some((line) => line.pending)) {
    let sum = 0;
    let ok = true;
    for (const line of lines) {
      if (line.resolved_unit_cost == null) {
        ok = false;
        break;
      }
      sum += line.qty * line.resolved_unit_cost;
    }
    miltonCost = ok ? sum : null;
  }

  const excel = input.proposal.excel_total;
  const match =
    assumedYield || anyPending
      ? null
      : decideWorkbookCostMatch(excel, miltonCost);
  const variance = workbookVarianceFields(excel, miltonCost);

  return {
    proposal: input.proposal,
    lines,
    status: anyPending ? "borrador" : "lista_para_aprobar",
    pending: anyPending,
    reasons,
    milton_cost: miltonCost,
    excel_match: match,
    variance_amount: variance.workbook_variance_amount,
    variance_pct: variance.workbook_variance_pct,
  };
}
