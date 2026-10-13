// Run AI recipe suggestions for ranked POS products against parsed
// workbook blocks. Checks are deterministic. Saves Borrador / Lista
// para aprobar versions and Sugerido links — never Aprobada / Confirmado.

import type { PreferredLanguage } from "@/lib/restaurant/language";
import { isImportProtectedSource } from "@/lib/restaurant/protect-imported-recipe";
import {
  suggestPosProductLink,
  unlinkedPosProduct,
  type PosProductLinkRecord,
} from "@/lib/restaurant/pos-product-links";
import {
  hasApprovedVersion,
  nextVersionNumber,
} from "@/lib/restaurant/recipe-versions";
import {
  assumedYieldReason,
  handmadeRecipeExistsReason,
  suggestionVersionNotes,
} from "./copy";
import { pickMenuItemForLocation } from "./persist-recipes";
import { normalizeMatchName } from "./names";
import {
  prefillLines,
  type PrefilledLine,
} from "@/lib/restaurant/recipe-costing/prefill";
import {
  prefillPreparations,
  type PreparationDraftSummary,
} from "@/lib/restaurant/recipe-costing/prefill-preparations";
import type { WorkbookAi } from "./ai";
import { proposeRecipeHeuristic } from "./propose-recipe";
import {
  SIN_SUGERENCIA,
  bindProposalToParsedBlock,
  isSinSugerencia,
  type ProposeRecipeResult,
  type RecipeSuggestionProduct,
} from "./propose-recipe";
import type { CatalogIngredient } from "./recipe-suggestion-checks";
import type { CostWorkbookRepo } from "./repo";
import { compactCandidateBlocks } from "./stored-blocks";
import type { GroupedRecipe, RecipeInputSnapshot } from "./types";
import { emptyUndoSnapshot } from "./types";

export interface RecipeSuggestionSkip {
  odoo_product_id: number;
  odoo_name: string;
  reason: string;
}

export interface RecipeSuggestionItem {
  odoo_product_id: number;
  odoo_name: string;
  result: "sugerido" | typeof SIN_SUGERENCIA | "omitido";
  status: "borrador" | "lista_para_aprobar" | null;
  menu_item_id: string | null;
  recipe_id: string | null;
  recipe_version_id: string | null;
  link_state: "sugerido" | "sin_vincular" | "confirmado" | null;
  pending: boolean;
  reasons: string[];
  evidence: Record<string, unknown>;
  excel_match: "match" | "mismatch" | null;
  milton_cost: number | null;
  excel_total: number | null;
}

export interface RecipeSuggestionRunResult {
  batch_id: string;
  suggested: number;
  skipped: number;
  sin_sugerencia: number;
  items: RecipeSuggestionItem[];
  skips: RecipeSuggestionSkip[];
  /** Preparation drafts created from the file's sub-recipe blocks. */
  preparations?: PreparationDraftSummary;
}

export async function proposeRecipeForProduct(input: {
  ai: WorkbookAi;
  product: RecipeSuggestionProduct;
  candidateBlocks: readonly GroupedRecipe[];
}): Promise<ProposeRecipeResult> {
  if (!input.ai.proposeRecipe) {
    return proposeRecipeHeuristic({
      product: input.product,
      candidateBlocks: input.candidateBlocks,
    });
  }
  try {
    const raw = await input.ai.proposeRecipe(
      input.product,
      input.candidateBlocks
    );
    if (isSinSugerencia(raw)) return SIN_SUGERENCIA;
    return bindProposalToParsedBlock(raw, input.candidateBlocks);
  } catch (err) {
    console.error("[proposeRecipe]", err);
    return proposeRecipeHeuristic({
      product: input.product,
      candidateBlocks: input.candidateBlocks,
    });
  }
}

function evidenceFromPrefill(
  proposal: ProposedRecipe,
  lines: readonly PrefilledLine[],
  checked: {
    status: "borrador" | "lista_para_aprobar";
    pending: boolean;
    reasons: string[];
    milton_cost: number | null;
    excel_match: "match" | "mismatch" | null;
  }
): Record<string, unknown> {
  return {
    tab: proposal.tab,
    block_name: proposal.block_name,
    confidence: proposal.confidence,
    evidence: proposal.evidence,
    yield: proposal.yield,
    excel_total: proposal.excel_total,
    milton_cost: checked.milton_cost,
    excel_match: checked.excel_match,
    variance_amount: null,
    variance_pct: null,
    status: checked.status,
    pending: checked.pending,
    reasons: checked.reasons,
    lines: lines.map((line) => ({
      source_row: line.source_row,
      raw_name: line.raw_name,
      ingredient_match:
        line.resolved?.kind === "ingredient" ? line.resolved.name : null,
      sub_recipe_match:
        line.resolved?.kind === "component" ? line.resolved.name : null,
      qty: line.qty,
      unit: line.unit,
      // Never the Excel number: costed from the catalog afterwards.
      unit_cost: null,
      excel_unit_cost: line.excel_unit_cost,
      unit_question: line.unit_question,
      flags: line.flags,
      pending: line.pending,
      reasons: line.reasons,
    })),
  };
}

type ProposedRecipe = Exclude<ProposeRecipeResult, typeof SIN_SUGERENCIA>;

export async function runRecipeSuggestions(input: {
  companyId: string;
  products: readonly RecipeSuggestionProduct[];
  candidateBlocks: readonly GroupedRecipe[];
  repo: CostWorkbookRepo;
  ai: WorkbookAi;
  currency: string;
  filename: string;
  locationId?: string | null;
  limit?: number;
  /** Skip this many products first (products are ranked by sales). */
  offset?: number;
  odooProductId?: number;
  lang?: PreferredLanguage;
  createdBy?: string | null;
}): Promise<RecipeSuggestionRunResult> {
  const lang = input.lang ?? "es";
  const locationId = input.locationId ?? null;
  const selected = input.odooProductId
    ? input.products.filter(
        (product) => product.odoo_product_id === input.odooProductId
      )
    : input.products.slice(
        Math.max(0, input.offset ?? 0),
        Math.max(0, input.offset ?? 0) + Math.max(1, input.limit ?? 20)
      );

  const batch = await input.repo.createBatch({
    companyId: input.companyId,
    filename: input.filename,
    fileMonth: null,
    currency: input.currency,
    importedCount: 0,
    reviewCount: 0,
    tabSummaries: [],
    mappingSource: "ai",
    createdBy: input.createdBy ?? null,
  });

  const [ingredients, menuItems, recipes, components, existingLinks, versions] =
    await Promise.all([
      input.repo.listIngredients(input.companyId),
      input.repo.listMenuItems(input.companyId),
      input.repo.listRecipes(input.companyId),
      input.repo.listComponents(input.companyId),
      input.repo.listPosProductLinks(input.companyId, locationId),
      Promise.all(
        (await input.repo.listRecipes(input.companyId)).map(async (recipe) => ({
          menu_item_id: recipe.menu_item_id,
          versions: await input.repo.listRecipeVersions(
            input.companyId,
            recipe.id
          ),
        }))
      ),
    ]);

  const versionsByMenu = new Map(
    versions.map((row) => [row.menu_item_id, row.versions])
  );
  const recipeByMenuId = new Map(recipes.map((row) => [row.menu_item_id, row]));
  const catalogIngredients: CatalogIngredient[] = ingredients.map((row) => ({
    id: row.id,
    name: row.name,
    current_unit_cost: row.current_unit_cost,
    default_unit: row.default_unit,
  }));
  // Names a person already confirmed for this company. Best effort: no
  // alias table yet (migration 039 pending) means nothing remembered.
  const aliases = new Map<string, string>();
  try {
    for (const row of await input.repo.listIngredientAliases(input.companyId)) {
      aliases.set(normalizeMatchName(row.alias_name), row.ingredient_id);
    }
  } catch {
    // nothing remembered
  }
  const liveComponents = components.map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const changes = emptyUndoSnapshot();
  // Keep the recipe blocks with this run from the start, so the next run
  // (or the next chunk) can use them even if this one stops halfway.
  changes.candidate_blocks = compactCandidateBlocks(input.candidateBlocks);
  await input.repo.updateBatchSnapshot(input.companyId, batch.id, changes);

  // Preparations first, so a dish line that uses one can point at it.
  const prefillIngredients = catalogIngredients.map((row) => ({
    id: row.id,
    name: row.name,
    default_unit: row.default_unit ?? null,
    unit_cost: row.current_unit_cost ?? null,
  }));
  let preparationDrafts: Awaited<ReturnType<typeof prefillPreparations>>;
  try {
    preparationDrafts = await prefillPreparations({
      repo: input.repo,
      companyId: input.companyId,
      batchId: batch.id,
      blocks: input.candidateBlocks,
      ingredients: prefillIngredients,
      aliases,
      changes,
    });
  } catch (err) {
    // Whatever was created before the error stays undoable with the batch.
    await input.repo.updateBatchSnapshot(input.companyId, batch.id, changes);
    throw err;
  }
  for (const prep of preparationDrafts.preparations) {
    if (!liveComponents.some((row) => row.id === prep.id)) {
      liveComponents.push(prep);
    }
  }

  const items: RecipeSuggestionItem[] = [];
  const skips: RecipeSuggestionSkip[] = [];
  let suggested = 0;
  let skipped = 0;
  let sinSugerencia = 0;

  const skipProduct = (
    product: RecipeSuggestionProduct,
    reason: string
  ): void => {
    skipped += 1;
    skips.push({
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      reason,
    });
    items.push({
      odoo_product_id: product.odoo_product_id,
      odoo_name: product.odoo_name,
      result: "omitido",
      status: null,
      menu_item_id: null,
      recipe_id: null,
      recipe_version_id: null,
      link_state: null,
      pending: true,
      reasons: [reason],
      evidence: {},
      excel_match: null,
      milton_cost: null,
      excel_total: null,
    });
  };

  for (const product of selected) {
    try {
      const existingLink = existingLinks.find(
        (link) =>
          link.company_id === input.companyId &&
          link.odoo_product_id === product.odoo_product_id &&
          (link.location_id === locationId || link.location_id == null)
      );
      if (existingLink?.link_state === "confirmado") {
        skipProduct(product, "este vínculo ya está Confirmado");
        continue;
      }

      const existingMenu =
        (existingLink?.menu_item_id
          ? menuItems.find((row) => row.id === existingLink.menu_item_id)
          : undefined) ??
        pickMenuItemForLocation(menuItems, product.odoo_name, locationId);
      const existingRecipe = existingMenu
        ? recipeByMenuId.get(existingMenu.id)
        : undefined;
      if (
        existingRecipe &&
        isImportProtectedSource(existingRecipe.source_type)
      ) {
        skipProduct(product, handmadeRecipeExistsReason(lang));
        continue;
      }
      const existingVersions = existingMenu
        ? (versionsByMenu.get(existingMenu.id) ?? [])
        : [];
      if (hasApprovedVersion(existingVersions)) {
        skipProduct(product, "esta receta ya está Aprobada");
        continue;
      }

      const proposed = await proposeRecipeForProduct({
        ai: input.ai,
        product,
        candidateBlocks: input.candidateBlocks,
      });
      if (isSinSugerencia(proposed)) {
        sinSugerencia += 1;
        items.push({
          odoo_product_id: product.odoo_product_id,
          odoo_name: product.odoo_name,
          result: SIN_SUGERENCIA,
          status: null,
          menu_item_id: existingMenu?.id ?? null,
          recipe_id: existingRecipe?.id ?? null,
          recipe_version_id: null,
          link_state: existingLink?.link_state ?? "sin_vincular",
          pending: true,
          reasons: [SIN_SUGERENCIA],
          evidence: {},
          excel_match: null,
          milton_cost: null,
          excel_total: null,
        });
        continue;
      }

      // Catalog-only prefill: names resolve to existing ingredients (exact
      // or a name a person already confirmed) or existing preparations; the
      // price is never taken from the Excel line.
      const prefilled = prefillLines({
        lines: proposed.lines.map((line) => ({
          source_row: line.source_row,
          raw_name: line.raw_name,
          qty: line.qty,
          unit: line.unit,
          excel_unit_cost:
            line.unit_cost != null && line.unit_cost > 0
              ? line.unit_cost
              : null,
        })),
        ingredients: prefillIngredients,
        preparations: liveComponents,
        aliases,
      });
      if (prefilled.length === 0 || !proposed.tab) {
        sinSugerencia += 1;
        items.push({
          odoo_product_id: product.odoo_product_id,
          odoo_name: product.odoo_name,
          result: SIN_SUGERENCIA,
          status: null,
          menu_item_id: existingMenu?.id ?? null,
          recipe_id: existingRecipe?.id ?? null,
          recipe_version_id: null,
          link_state: existingLink?.link_state ?? "sin_vincular",
          pending: true,
          reasons: [SIN_SUGERENCIA],
          evidence: {},
          excel_match: null,
          milton_cost: null,
          excel_total: null,
        });
        continue;
      }
      const assumedYield = proposed.yield.source === "assumed";
      const anyPending = prefilled.some((line) => line.pending) || assumedYield;
      const reasons = [...new Set(prefilled.flatMap((line) => line.reasons))];
      if (assumedYield) reasons.push(assumedYieldReason(lang));
      const checked = {
        proposal: proposed,
        status: (anyPending ? "borrador" : "lista_para_aprobar") as
          | "borrador"
          | "lista_para_aprobar",
        pending: anyPending,
        reasons,
        // Costed from the catalog right after this run (refreshEvidence).
        milton_cost: null as number | null,
        excel_match: null as "match" | "mismatch" | null,
      };
      const evidence = evidenceFromPrefill(proposed, prefilled, checked);
      const resolvedInputs: RecipeInputSnapshot[] = prefilled
        .filter((line) => line.resolved && line.unit_ok)
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

      let menuItem = existingMenu;
      if (!menuItem) {
        menuItem = await input.repo.createMenuItem({
          companyId: input.companyId,
          name: product.odoo_name,
          currency: input.currency,
          sourceId: batch.id,
          locationId,
          sellingPrice: 0,
        });
        changes.created_menu_item_ids.push(menuItem.id);
        menuItems.push(menuItem);
      }

      let recipe = existingRecipe;
      if (!recipe) {
        recipe = await input.repo.createRecipe({
          companyId: input.companyId,
          menuItemId: menuItem.id,
          name: product.odoo_name,
          sourceId: batch.id,
          inputs: resolvedInputs,
        });
        changes.created_recipe_ids.push(recipe.id);
        recipeByMenuId.set(menuItem.id, recipe);
      }

      const version = await input.repo.insertRecipeVersion({
        companyId: input.companyId,
        recipeId: recipe.id,
        menuItemId: menuItem.id,
        versionNumber: nextVersionNumber(
          await input.repo.listRecipeVersions(input.companyId, recipe.id)
        ),
        status: "in_review",
        effectiveDate: null,
        sourceType: "import",
        notes: suggestionVersionNotes(checked.status),
        inputs: resolvedInputs,
      });
      changes.created_recipe_version_ids = [
        ...(changes.created_recipe_version_ids ?? []),
        version.id,
      ];

      const baseLink: PosProductLinkRecord =
        existingLink ??
        unlinkedPosProduct({
          company_id: input.companyId,
          odoo_product_id: product.odoo_product_id,
          odoo_name: product.odoo_name,
          location_id: locationId,
        });
      const suggestedLink = suggestPosProductLink(baseLink, {
        // The treatment stays what a person chose (or por_clasificar).
        menu_item_id: menuItem.id,
        evidence,
      });
      const savedLink = await input.repo.upsertPosProductLink(
        input.companyId,
        suggestedLink
      );
      if (savedLink.created) {
        changes.created_pos_product_link_ids = [
          ...(changes.created_pos_product_link_ids ?? []),
          savedLink.id,
        ];
      } else if (savedLink.before) {
        changes.updated_pos_product_links = [
          ...(changes.updated_pos_product_links ?? []),
          { id: savedLink.id, before: savedLink.before },
        ];
      }
      if (!existingLinks.some((row) => row.id === savedLink.id)) {
        existingLinks.push({ ...suggestedLink, id: savedLink.id });
      }

      suggested += 1;
      items.push({
        odoo_product_id: product.odoo_product_id,
        odoo_name: product.odoo_name,
        result: "sugerido",
        status: checked.status,
        menu_item_id: menuItem.id,
        recipe_id: recipe.id,
        recipe_version_id: version.id,
        link_state: "sugerido",
        pending: checked.pending,
        reasons: checked.reasons,
        evidence,
        excel_match: checked.excel_match,
        milton_cost: checked.milton_cost,
        excel_total: checked.proposal.excel_total,
      });
    } catch (err) {
      // One dish failing never stops the others; the reason is shown.
      console.error("[recipe-suggestions product]", err);
      skipProduct(
        product,
        `no pude preparar este plato: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  await input.repo.updateBatchSnapshot(input.companyId, batch.id, changes);
  return {
    batch_id: batch.id,
    suggested,
    skipped,
    sin_sugerencia: sinSugerencia,
    items,
    skips,
    preparations: preparationDrafts.summary,
  };
}
