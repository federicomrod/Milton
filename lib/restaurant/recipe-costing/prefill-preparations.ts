// Create preparation drafts from the file's sub-recipe blocks, so dish lines
// that use a preparation can point at it.
//
// Drafts only: every preparation gets an in-review version that does not
// count anywhere until a person approves it. Lines are prefilled against
// the catalog with the same rules as dishes (exact name or a confirmed
// name; never an Excel price). A yield the Excel does not state plainly is
// a suggestion that stays open. Existing preparations are never touched.

import { fmt, getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { lineUnitCostFromRaw } from "@/lib/restaurant/cost-workbook/propose-recipe";
import { yieldSourceForBlock } from "@/lib/restaurant/cost-workbook/propose-recipe";
import type { CostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo";
import type {
  GroupedRecipe,
  RecipeInputSnapshot,
  UndoSnapshot,
} from "@/lib/restaurant/cost-workbook/types";
import { normalizeUnit } from "@/lib/restaurant/units";
import {
  prefillLines,
  type PrefillCatalogIngredient,
  type PrefilledLine,
} from "./prefill";

export const PREPARATION_DRAFT_KIND = "preparation_draft";

export interface PreparationDraftSummary {
  created: number;
  reused: number;
  skipped_ambiguous: number;
  lines: number;
  lines_added: number;
  yields_to_confirm: number;
  unit_questions: number;
  drafts_with_open_items: number;
}

function outputUnitOf(block: GroupedRecipe): string {
  const unit = normalizeUnit(block.output_unit ?? "");
  return unit ?? "unit";
}

export async function prefillPreparations(input: {
  repo: CostWorkbookRepo;
  companyId: string;
  batchId: string;
  blocks: readonly GroupedRecipe[];
  ingredients: readonly PrefillCatalogIngredient[];
  aliases: ReadonlyMap<string, string>;
  changes: UndoSnapshot;
  /** Language of the review reasons (default Spanish). */
  lang?: PreferredLanguage;
}): Promise<{
  preparations: Array<{ id: string; name: string }>;
  summary: PreparationDraftSummary;
}> {
  const msg = getDictionary(input.lang ?? "es").menu.editor.preparations;
  const summary: PreparationDraftSummary = {
    created: 0,
    reused: 0,
    skipped_ambiguous: 0,
    lines: 0,
    lines_added: 0,
    yields_to_confirm: 0,
    unit_questions: 0,
    drafts_with_open_items: 0,
  };

  const existing = await input.repo.listComponents(input.companyId);
  const preparations = existing.map((row) => ({ id: row.id, name: row.name }));
  const existingKeys = new Set(
    preparations.map((row) => normalizeMatchName(row.name))
  );

  // Two blocks with the same name are ambiguous: create neither.
  const byKey = new Map<string, GroupedRecipe[]>();
  for (const block of input.blocks) {
    if (block.kind !== "sub_recipe") continue;
    const key = normalizeMatchName(block.name);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), block]);
  }

  // Pass 1: create the preparations, so pass 2 can resolve nested ones.
  const toFill: Array<{ block: GroupedRecipe; componentId: string }> = [];
  for (const [key, blocks] of byKey) {
    if (existingKeys.has(key)) {
      summary.reused += 1;
      continue;
    }
    if (blocks.length > 1) {
      summary.skipped_ambiguous += 1;
      continue;
    }
    const block = blocks[0]!;
    const component = await input.repo.createComponent({
      companyId: input.companyId,
      name: block.name,
      outputUnit: outputUnitOf(block),
      sourceId: input.batchId,
    });
    input.changes.created_component_ids.push(component.id);
    preparations.push({ id: component.id, name: component.name });
    toFill.push({ block, componentId: component.id });
    summary.created += 1;
  }

  // Pass 2: prefill each new preparation's recipe and open a draft.
  const review: Parameters<CostWorkbookRepo["insertReviewItems"]>[0] = [];
  for (const { block, componentId } of toFill) {
    const lines = [...block.lines, ...(block.pending_lines ?? [])];
    const prefilled = prefillLines({
      lines: lines.map((line) => ({
        source_row: line.rowIndex,
        raw_name: line.ingredient_name,
        qty: line.quantity,
        unit: line.unit,
        excel_unit_cost: lineUnitCostFromRaw(line.raw),
      })),
      ingredients: input.ingredients,
      // A preparation never points at itself.
      preparations: preparations.filter((p) => p.id !== componentId),
      aliases: input.aliases,
      lang: input.lang,
    });
    const inputs: RecipeInputSnapshot[] = prefilled
      .filter((line) => addable(line))
      .map((line) => ({
        input_type: line.resolved!.kind,
        ingredient_id:
          line.resolved!.kind === "ingredient" ? line.resolved!.id : null,
        component_id:
          line.resolved!.kind === "component" ? line.resolved!.id : null,
        quantity: line.qty,
        unit: line.unit,
        notes: null,
      }));
    summary.lines += prefilled.length;
    summary.unit_questions += prefilled.filter((l) => l.unit_question).length;
    summary.lines_added += inputs.length;

    const yieldSource = yieldSourceForBlock(block);
    const outputQuantity =
      block.output_quantity != null && block.output_quantity > 0
        ? block.output_quantity
        : 1;
    const outputUnit = outputUnitOf(block);
    const recipe = await input.repo.createComponentRecipe({
      companyId: input.companyId,
      componentId,
      name: block.name,
      outputQuantity,
      outputUnit,
      sourceId: input.batchId,
      inputs,
    });
    input.changes.created_component_recipe_ids.push(recipe.id);
    await input.repo.insertComponentRecipeVersion({
      companyId: input.companyId,
      componentRecipeId: recipe.id,
      componentId,
      versionNumber: 1,
      status: "in_review",
      effectiveDate: null,
      outputQuantity,
      outputUnit,
      sourceType: "import",
      inputs,
    });

    const yieldToConfirm = yieldSource !== "excel";
    if (yieldToConfirm) summary.yields_to_confirm += 1;
    const open = prefilled.filter((line) => line.pending);
    if (open.length > 0 || yieldToConfirm) {
      summary.drafts_with_open_items += 1;
      const parts: string[] = [];
      if (open.length > 0) {
        parts.push(
          fmt(open.length === 1 ? msg.openLinesOne : msg.openLinesOther, {
            count: open.length,
          })
        );
      }
      if (yieldToConfirm) {
        parts.push(
          fmt(msg.yieldToConfirm, {
            quantity: outputQuantity,
            unit: outputUnit,
          })
        );
      }
      review.push({
        company_id: input.companyId,
        batch_id: input.batchId,
        tab_name: block.tabName,
        row_index: block.start_row_index ?? lines[0]?.rowIndex ?? 0,
        reason: fmt(msg.reviewReason, {
          name: block.name,
          parts: parts.join(" · "),
        }),
        raw_values: {
          kind: PREPARATION_DRAFT_KIND,
          component_id: componentId,
          component_recipe_id: recipe.id,
          name: block.name,
          yield: {
            value: outputQuantity,
            unit: outputUnit,
            source: yieldSource,
            confirmed: !yieldToConfirm,
          },
          excel_total: block.cost_total ?? null,
          lines: prefilled.map((line) => ({
            source_row: line.source_row,
            raw_name: line.raw_name,
            qty: line.qty,
            unit: line.unit,
            excel_unit_cost: line.excel_unit_cost,
            resolved: line.resolved,
            unit_question: line.unit_question,
            pending: line.pending,
            reasons: line.reasons,
          })),
        },
        suggested: null,
        status: "pending",
      });
    }
  }
  if (review.length > 0) await input.repo.insertReviewItems(review);

  return { preparations, summary };
}

/** A line goes into the recipe only when it is resolved, its unit is
 *  readable, and there is no open unit question. */
function addable(line: PrefilledLine): boolean {
  return Boolean(line.resolved) && line.unit_ok && !line.unit_question;
}
