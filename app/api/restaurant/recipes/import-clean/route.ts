// POST /api/restaurant/recipes/import-clean
//
// Simple importer for pre-processed recipe JSON from Claude Code.
// Accepts a clean, fixed format and persists it directly without parsing Excel.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/api/auth-check";
import { createCostWorkbookRepo } from "@/lib/restaurant/cost-workbook/repo-server";
import {
  persistWorkbookRecipes,
  linkMenuItemsToPos,
} from "@/lib/restaurant/cost-workbook/persist-recipes";
import { emptyUndoSnapshot, type GroupedRecipe } from "@/lib/restaurant/cost-workbook/types";
import { t } from "@/lib/restaurant/language";
import type { PreferredLanguage } from "@/lib/restaurant/language";

interface CleanRecipeLine {
  ingredient: string;
  quantity: number;
  unit: string;
  cost: number;
}

interface CleanRecipe {
  dish_name: string;
  selling_price?: number | null;
  lines: CleanRecipeLine[];
  excel_cost_total?: number | null;
}

interface CleanSubRecipe {
  name: string;
  yield_quantity: number;
  yield_unit: string;
  lines: CleanRecipeLine[];
  excel_cost_total?: number | null;
}

interface CleanImportPayload {
  recipes: CleanRecipe[];
  sub_recipes: CleanSubRecipe[];
}

function convertToGroupedRecipe(
  recipe: CleanRecipe,
  kind: "recipe"
): GroupedRecipe {
  return {
    kind,
    tabName: "imported",
    name: recipe.dish_name,
    lines: recipe.lines.map((line, i) => ({
      tabName: "imported",
      rowIndex: i,
      ingredient_name: line.ingredient,
      quantity: line.quantity,
      unit: line.unit,
      raw: {
        Ingrediente: line.ingredient,
        Cantidad: line.quantity,
        Unidad: line.unit,
        Costo: line.cost,
      },
    })),
    selling_price: recipe.selling_price ?? null,
    cost_total: recipe.excel_cost_total ?? null,
    yield_quantity: null,
    yield_unit: null,
    yield_assumed: false,
    incomplete_lines: false,
    block_layout: false,
  };
}

function convertToGroupedSubRecipe(
  subRecipe: CleanSubRecipe,
  kind: "sub_recipe"
): GroupedRecipe {
  return {
    kind,
    tabName: "imported",
    name: subRecipe.name,
    lines: subRecipe.lines.map((line, i) => ({
      tabName: "imported",
      rowIndex: i,
      ingredient_name: line.ingredient,
      quantity: line.quantity,
      unit: line.unit,
      raw: {
        Ingrediente: line.ingredient,
        Cantidad: line.quantity,
        Unidad: line.unit,
        Costo: line.cost,
      },
    })),
    selling_price: null,
    cost_total: subRecipe.excel_cost_total ?? null,
    yield_quantity: subRecipe.yield_quantity,
    yield_unit: subRecipe.yield_unit,
    yield_assumed: subRecipe.yield_quantity === 1 && subRecipe.yield_unit === "unit",
    incomplete_lines: false,
    block_layout: false,
  };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const companyId = session.user.companyId;
  if (!companyId) {
    return NextResponse.json(
      { error: "No restaurant selected" },
      { status: 400 }
    );
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const locationId = (formData.get("location_id") as string) || null;
    const brandId = (formData.get("brand_id") as string) || null;
    const currency = (formData.get("currency") as string) || "MXN";
    const langParam = (formData.get("lang") as string) || "es";
    const lang: PreferredLanguage = langParam === "en" ? "en" : "es";

    if (!file) {
      return NextResponse.json(
        { error: t(lang, "No file uploaded", "No se subió ningún archivo") },
        { status: 400 }
      );
    }

    const text = await file.text();
    let payload: CleanImportPayload;
    try {
      payload = JSON.parse(text) as CleanImportPayload;
    } catch (err) {
      return NextResponse.json(
        {
          error: t(
            lang,
            "Invalid JSON format",
            "Formato JSON inválido"
          ),
          details: err instanceof Error ? err.message : String(err),
        },
        { status: 400 }
      );
    }

    // Validate payload
    if (!Array.isArray(payload.recipes) || !Array.isArray(payload.sub_recipes)) {
      return NextResponse.json(
        {
          error: t(
            lang,
            'JSON must have "recipes" and "sub_recipes" arrays',
            'El JSON debe tener arreglos "recipes" y "sub_recipes"'
          ),
        },
        { status: 400 }
      );
    }

    // Convert to internal format
    const groups: GroupedRecipe[] = [
      ...payload.sub_recipes.map((sr) => convertToGroupedSubRecipe(sr, "sub_recipe")),
      ...payload.recipes.map((r) => convertToGroupedRecipe(r, "recipe")),
    ];

    if (groups.length === 0) {
      return NextResponse.json(
        {
          error: t(
            lang,
            "No recipes found in file",
            "No se encontraron recetas en el archivo"
          ),
        },
        { status: 400 }
      );
    }

    const repo = createCostWorkbookRepo();

    // Create a batch record
    const batch = await repo.createBatch({
      companyId,
      filename: file.name,
      fileMonth: new Date().toISOString().slice(0, 7), // current month
      currency,
      importedCount: groups.reduce((sum, g) => sum + g.lines.length, 0),
      reviewCount: 0,
      tabSummaries: [{
        name: "imported",
        type: "recipe",
        confidence: 1,
        mapping_source: "fixed",
        column_mapping: {},
        imported_count: groups.reduce((sum, g) => sum + g.lines.length, 0),
        review_count: 0,
        skipped_count: 0,
        skipped_reasons: [],
        preview: [],
      }],
      mappingSource: "fixed",
      createdBy: session.user.id,
    });

    // Persist recipes
    const recipeStats = await persistWorkbookRecipes({
      companyId,
      batchId: batch.id,
      currency,
      groups,
      repo,
      aliases: new Map(),
      locationId,
      brandId,
      lang,
      effectiveDate: new Date().toISOString().slice(0, 10),
      createMissingIngredients: true,
    });

    // Link to POS
    const menuItems = await repo.listMenuItems(companyId);
    const importedMenuItems = menuItems.filter(
      (item) =>
        item.source_id === batch.id ||
        recipeStats.changes.created_menu_item_ids.includes(item.id)
    );
    const posStats = await linkMenuItemsToPos({
      companyId,
      menuItems: importedMenuItems,
      repo,
      locationId,
      lang,
    });

    // Update batch with final snapshot
    const finalChanges = {
      ...recipeStats.changes,
      created_mapping_ids: [
        ...(recipeStats.changes.created_mapping_ids ?? []),
        ...posStats.mappingIds,
      ],
    };
    await repo.updateBatchSnapshot(companyId, batch.id, finalChanges);

    return NextResponse.json({
      kind: "clean_import",
      batch_id: batch.id,
      headline: t(
        lang,
        `Imported ${recipeStats.recipesCreated} recipes and ${recipeStats.subRecipesCreated} sub-recipes from ${file.name}.`,
        `Se importaron ${recipeStats.recipesCreated} recetas y ${recipeStats.subRecipesCreated} sub-recetas desde ${file.name}.`
      ),
      recipes_created: recipeStats.recipesCreated,
      sub_recipes_created: recipeStats.subRecipesCreated,
      menu_items_created: recipeStats.menuItemsCreated,
      pos_links_created: posStats.linked,
      review_count: recipeStats.review.length + posStats.review.length,
      review_items: [...recipeStats.review, ...posStats.review],
      skipped_count: recipeStats.skipped.length + posStats.skipped.length,
      currency,
    });
  } catch (err) {
    console.error("[import-clean]", err);
    return NextResponse.json(
      {
        error: t(
          "en",
          "Import failed",
          "La importación falló"
        ),
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
