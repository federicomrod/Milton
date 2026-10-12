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
import { handmadeRecipeExistsReason, suggestionVersionNotes } from "./copy";
import {
  pickMenuItemForLocation,
  resolveCatalogInput,
  withQty,
} from "./persist-recipes";
import type { WorkbookAi } from "./ai";
import { proposeRecipeHeuristic } from "./propose-recipe";
import {
  SIN_SUGERENCIA,
  bindProposalToParsedBlock,
  isSinSugerencia,
  type ProposeRecipeResult,
  type RecipeSuggestionProduct,
} from "./propose-recipe";
import {
  catalogFromBlocks,
  checkRecipeProposal,
  type CatalogIngredient,
  type CatalogSubRecipe,
  type CheckedRecipeProposal,
} from "./recipe-suggestion-checks";
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

function evidenceFor(checked: CheckedRecipeProposal): Record<string, unknown> {
  return {
    tab: checked.proposal.tab,
    block_name: checked.proposal.block_name,
    confidence: checked.proposal.confidence,
    evidence: checked.proposal.evidence,
    yield: checked.proposal.yield,
    excel_total: checked.proposal.excel_total,
    milton_cost: checked.milton_cost,
    excel_match: checked.excel_match,
    variance_amount: checked.variance_amount,
    variance_pct: checked.variance_pct,
    status: checked.status,
    pending: checked.pending,
    reasons: checked.reasons,
    lines: checked.lines.map((line) => ({
      source_row: line.source_row,
      raw_name: line.raw_name,
      ingredient_match: line.ingredient_match,
      sub_recipe_match: line.sub_recipe_match,
      qty: line.qty,
      unit: line.unit,
      unit_cost: line.resolved_unit_cost,
      flags: line.flags,
      pending: line.pending,
    })),
  };
}

function inputsFromChecked(
  checked: CheckedRecipeProposal,
  ingredients: CatalogIngredient[],
  components: Array<{ id: string; name: string }>,
  lang: PreferredLanguage
): RecipeInputSnapshot[] {
  const inputs: RecipeInputSnapshot[] = [];
  for (const line of checked.lines) {
    if (line.pending) continue;
    const resolved = resolveCatalogInput(
      line.sub_recipe_match ?? line.ingredient_match ?? line.raw_name,
      ingredients,
      components,
      new Map(),
      lang
    );
    if (!resolved.ok) continue;
    inputs.push(
      withQty(resolved.input, {
        tabName: checked.proposal.tab,
        rowIndex: line.source_row,
        recipeName: checked.proposal.block_name,
        ingredient_name: line.raw_name,
        quantity: line.qty,
        unit: line.resolved_unit ?? line.unit,
        raw: {},
      })
    );
  }
  return inputs;
}

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
    : input.products.slice(0, Math.max(1, input.limit ?? 20));

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
  const catalogSubs: CatalogSubRecipe[] = [
    ...catalogFromBlocks(input.candidateBlocks),
    ...components.map((row) => ({
      id: row.id,
      name: row.name,
      output_unit: row.output_unit,
    })),
  ];
  const liveComponents = components.map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const changes = emptyUndoSnapshot();
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
    if (existingRecipe && isImportProtectedSource(existingRecipe.source_type)) {
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

    const checked = checkRecipeProposal({
      proposal: proposed,
      ingredients: catalogIngredients,
      subRecipes: catalogSubs,
      lang,
    });
    if (checked.lines.length === 0 || !checked.proposal.tab) {
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
    const evidence = evidenceFor(checked);
    const resolvedInputs = inputsFromChecked(
      checked,
      catalogIngredients,
      liveComponents,
      lang
    );

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
      menu_item_id: menuItem.id,
      classification: "requiere_receta",
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
  }

  changes.candidate_blocks = compactCandidateBlocks(input.candidateBlocks);
  await input.repo.updateBatchSnapshot(input.companyId, batch.id, changes);
  return {
    batch_id: batch.id,
    suggested,
    skipped,
    sin_sugerencia: sinSugerencia,
    items,
    skips,
  };
}
