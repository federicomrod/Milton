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
import {
  applyPriceCatalog,
  planCatalog,
} from "@/lib/restaurant/price-catalog/apply";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
import { readCatalogFromBuffer } from "@/lib/restaurant/price-catalog/server";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const path = process.env.MILTON_REAL_WORKBOOK;

function plainName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

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

  it("reads the price list, finds conflicts, and saves only a reviewed catalog", async () => {
    const buffer = readFileSync(path as string);
    const { read, observations } = readCatalogFromBuffer(buffer);
    expect(read).not.toBeNull();
    const rows = read!.rows;
    const count = (pick: (r: (typeof rows)[number]) => boolean) =>
      rows.filter(pick).length;

    // Pretend a person confirmed every suggested unit and decided nothing
    // about conflicts or ambiguous rows.
    const confirmed: Record<string, { unit: "oz" | "lb" | "unit" | "g" }> = {};
    for (const row of rows) {
      if (row.status === "check_unit" && row.unit) {
        confirmed[row.key] = { unit: row.unit };
      }
    }
    const store = emptyMemoryStore();
    const result = await applyPriceCatalog({
      repo: createMemoryCostWorkbookRepo(store),
      companyId: "co-real",
      userId: "u-real",
      currency: "USD",
      filename: "real-workbook-Abril-2026.xlsx",
      read: read!,
      observations,
      decisions: { rows: confirmed, conflicts: {} },
    });
    const plan = planCatalog(read!, { rows: confirmed });

    // Then the recipe lines against that catalog: how many resolve by
    // an exact name (what the dropdown and prefill can use as-is).
    const catalogNames = new Set(
      store.ingredients.map((row) => plainName(row.name))
    );
    const blocks = collectWorkbookCandidateBlocks({ buffer, lang: "es" }).all;
    const prepNames = new Set(blocks.map((block) => plainName(block.name)));
    let lines = 0;
    let exact = 0;
    let preparation = 0;
    const unresolvedByName = new Map<string, number>();
    for (const block of blocks) {
      for (const line of block.lines) {
        lines += 1;
        const key = plainName(line.ingredient_name);
        if (catalogNames.has(key)) exact += 1;
        else if (prepNames.has(key)) preparation += 1;
        else unresolvedByName.set(key, (unresolvedByName.get(key) ?? 0) + 1);
      }
    }

    const aggregates = {
      catalog_rows: rows.length,
      ready_as_read: count((r) => r.status === "ok" && r.kind === "ingredient"),
      unit_to_confirm: count((r) => r.status === "check_unit"),
      unit_ambiguous: count((r) => r.status === "ambiguous_unit"),
      error_or_empty_cell: count(
        (r) => r.status === "error_cell" || r.status === "no_price"
      ),
      preparations_left_out: plan.preparations,
      per_gram_inferred: count((r) => r.reasons.includes("per_gram_inferred")),
      recipe_line_costs_seen: observations.length,
      ingredients_saved: store.ingredients.length,
      price_entries_saved: store.costEntries.length,
      conflicts_found: result.conflicts_total,
      conflicts_open_after_save: result.conflicts_open,
      all_usd:
        store.ingredients.every((i) => i.currency === "USD") &&
        store.costEntries.every((e) => e.currency === "USD"),
      recipe_lines_total: lines,
      recipe_lines_exact_in_catalog: exact,
      recipe_lines_exact_preparation: preparation,
      recipe_lines_still_unresolved: lines - exact - preparation,
      unresolved_distinct_names: unresolvedByName.size,
      unresolved_lines_covered_by_top_20_names: [...unresolvedByName.values()]
        .sort((a, b) => b - a)
        .slice(0, 20)
        .reduce((sum, n) => sum + n, 0),
    };
    console.log("REAL-FILE CATALOG " + JSON.stringify(aggregates));

    expect(aggregates.all_usd).toBe(true);
    // The catalog is only ever created from price rows.
    expect(aggregates.ingredients_saved).toBeLessThanOrEqual(
      aggregates.catalog_rows
    );
  });
});
