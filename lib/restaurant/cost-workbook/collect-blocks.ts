// Collect COSTO RESTAURANTE recipe blocks from an uploaded workbook.
// Reuses sheets.ts + blocks.ts + recipes.ts. No AI guessing.

import { nameKey } from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  collectCostoRestauranteBlockNames,
  collectCostoRestauranteBlocks,
  sheetLooksLikeCostoRestauranteBlocks,
} from "./blocks";
import { isExplicitSubRecipeName } from "./classify";
import { collectRecipeLines } from "./recipes";
import { mapColumnsHeuristic } from "./ai";
import { readWorkbookSheetsFromWorkbook, readXlsxWorkbook } from "./sheets";
import type { GroupedRecipe } from "./types";

export interface CollectedWorkbookBlocks {
  dishes: GroupedRecipe[];
  subRecipes: GroupedRecipe[];
  all: GroupedRecipe[];
}

function tabKindFromSheet(name: string): "recipe" | "sub_recipe" {
  return isExplicitSubRecipeName(name) ? "sub_recipe" : "recipe";
}

export function collectWorkbookCandidateBlocks(input: {
  buffer: Buffer;
  lang?: PreferredLanguage;
}): CollectedWorkbookBlocks {
  const lang = input.lang ?? "es";
  const sheets = readWorkbookSheetsFromWorkbook(readXlsxWorkbook(input.buffer));
  const knownSubRecipeNames = new Set<string>();
  for (const sheet of sheets) {
    if (sheet.aoa && sheetLooksLikeCostoRestauranteBlocks(sheet.aoa)) {
      if (tabKindFromSheet(sheet.name) === "sub_recipe") {
        for (const name of collectCostoRestauranteBlockNames(sheet.aoa)) {
          knownSubRecipeNames.add(name);
        }
      }
    }
  }

  const dishes: GroupedRecipe[] = [];
  const subRecipes: GroupedRecipe[] = [];

  for (const sheet of sheets) {
    const kind = tabKindFromSheet(sheet.name);
    if (sheet.aoa && sheetLooksLikeCostoRestauranteBlocks(sheet.aoa)) {
      const collected = collectCostoRestauranteBlocks({
        tabName: sheet.name,
        tabKind: kind,
        aoa: sheet.aoa,
        knownSubRecipeNames,
        lang,
      });
      if (kind === "sub_recipe") subRecipes.push(...collected.groups);
      else dishes.push(...collected.groups);
      continue;
    }
    if (kind !== "recipe" && kind !== "sub_recipe") continue;
    const mapping = mapColumnsHeuristic({
      tabType: kind,
      headers: sheet.headers,
      sampleRows: sheet.sampleRows,
    });
    if (
      !mapping.ingredient_name?.column ||
      !mapping.quantity?.column ||
      !mapping.unit?.column
    ) {
      continue;
    }
    const collected = collectRecipeLines({
      tabName: sheet.name,
      tabKind: kind,
      dataRows: sheet.dataRows,
      mapping,
      knownSubRecipeNames,
      lang,
    });
    if (kind === "sub_recipe") subRecipes.push(...collected.groups);
    else dishes.push(...collected.groups);
  }

  const seen = new Set<string>();
  const unique = (groups: GroupedRecipe[]) =>
    groups.filter((group) => {
      const key = `${group.kind}:${nameKey(group.tabName)}:${nameKey(group.name)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  const uniqueDishes = unique(dishes);
  const uniqueSubs = unique(subRecipes);
  return {
    dishes: uniqueDishes,
    subRecipes: uniqueSubs,
    all: [...uniqueSubs, ...uniqueDishes],
  };
}
