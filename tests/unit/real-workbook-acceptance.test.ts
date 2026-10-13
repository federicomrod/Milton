// Real-workbook acceptance run (aggregate counts only).
//
// Skipped unless MILTON_REAL_WORKBOOK points at a workbook that lives
// OUTSIDE this repository. It prints totals only: never a name, a price
// or a row. The repo is public and the workbook is client data.
//
//   MILTON_REAL_WORKBOOK="/path/outside/repo/file.xlsx" \
//     npx vitest run tests/unit/real-workbook-acceptance.test.ts

import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  classifyCostTabHeuristic,
  mapColumnsHeuristic,
} from "@/lib/restaurant/cost-workbook/ai";
import { importCostWorkbook } from "@/lib/restaurant/cost-workbook";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const path = process.env.MILTON_REAL_WORKBOOK;

// Offline stand-in for the AI step: heuristics only, no network.
const heuristicAi: WorkbookAi = {
  proposeRecipe: async () => "sin sugerencia",
  classifyTab: async (input) => classifyCostTabHeuristic(input),
  mapColumns: async (input) => mapColumnsHeuristic(input),
};

describe.skipIf(!path)("real workbook acceptance (aggregates only)", () => {
  it("never creates an ingredient from a recipe line", async () => {
    const store = emptyMemoryStore();
    const result = await importCostWorkbook({
      companyId: "co-real",
      filename: "real-workbook.xlsx",
      buffer: readFileSync(path as string),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      ai: heuristicAi,
      lang: "es",
    });

    const reasons = result.review_items.map((item) => item.reason);
    const held = reasons.filter((r) => r.startsWith("Posible coincidencia"));
    const unknownLine = reasons.filter((r) =>
      /no conozco|desconocid|unknown ingredient/i.test(r)
    );
    const unsureLine = reasons.filter((r) => /no estoy seguro de si/.test(r));
    const tabTypes: Record<string, number> = {};
    for (const tab of result.tabs) {
      tabTypes[tab.type] = (tabTypes[tab.type] ?? 0) + 1;
    }

    const aggregates = {
      tabs: result.tab_count,
      tab_types: tabTypes,
      ingredients_in_catalog: store.ingredients.length,
      ingredients_with_price_entry: new Set(
        store.costEntries.map((entry) => entry.ingredient_id)
      ).size,
      saved_price_rows: result.saved_count,
      review_rows: result.review_count,
      skipped_rows: result.skipped_count,
      price_rows_held_as_possible_match: held.length,
      recipe_lines_unknown_name: unknownLine.length,
      recipe_lines_unsure_name: unsureLine.length,
      dishes_imported: result.menu_items_created,
      recipes_imported: result.recipes_created,
      sub_recipes_imported: result.sub_recipes_created,
    };
    console.log("REAL-FILE AGGREGATES " + JSON.stringify(aggregates));

    // Every ingredient in the catalog must be backed by a price row from
    // a price list, never by a recipe line.
    expect(aggregates.ingredients_in_catalog).toBe(
      aggregates.ingredients_with_price_entry
    );
  });
});
