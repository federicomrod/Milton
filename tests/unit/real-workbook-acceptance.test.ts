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
import { bestNameMatch } from "@/lib/restaurant/cost-workbook/names";
import { matchExistingIngredient } from "@/lib/restaurant/recipe-costing/ingredient-match";
import { runRecipeSuggestions } from "@/lib/restaurant/cost-workbook/recipe-suggestion";
import { proposeRecipeHeuristic } from "@/lib/restaurant/cost-workbook/propose-recipe";
import { preparationImpact } from "@/lib/restaurant/recipe-costing/preparation-impact";
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

  it("how many recipe lines need no click, one click, or a pick (Validar)", async () => {
    const buffer = readFileSync(path as string);
    const { read, observations } = readCatalogFromBuffer(buffer);
    const confirmed: Record<string, { unit: "oz" | "lb" | "unit" | "g" }> = {};
    for (const row of read!.rows) {
      if (row.status === "check_unit" && row.unit) {
        confirmed[row.key] = { unit: row.unit };
      }
    }
    const store = emptyMemoryStore();
    await applyPriceCatalog({
      repo: createMemoryCostWorkbookRepo(store),
      companyId: "co-real",
      userId: "u-real",
      currency: "USD",
      filename: "real-workbook-Abril-2026.xlsx",
      read: read!,
      observations,
      decisions: { rows: confirmed, conflicts: {} },
    });

    const blocks = collectWorkbookCandidateBlocks({ buffer, lang: "es" });
    const refs = store.ingredients.map((row) => ({
      id: row.id,
      name: row.name,
      default_unit: row.default_unit,
    }));
    const preparations = blocks.subRecipes.map((block) => ({
      id: block.name,
      name: block.name,
    }));
    const exactPrep = new Set(preparations.map((p) => plainName(p.name)));

    function classify(name: string): "none" | "one" | "pick" {
      const hit = matchExistingIngredient(name, refs);
      if (hit.kind === "exact") return "none";
      if (exactPrep.has(plainName(name))) return "none";
      if (hit.kind === "possible") return "one";
      const prep = bestNameMatch(name, preparations, (p) => p.name);
      if (prep && prep.score >= 0.85) return "one";
      return "pick";
    }

    function tally(groups: typeof blocks.dishes) {
      const counts = { none: 0, one: 0, pick: 0 };
      const pickNames = new Map<string, number>();
      for (const block of groups) {
        for (const line of block.lines) {
          const kind = classify(line.ingredient_name);
          counts[kind] += 1;
          if (kind === "pick") {
            const key = plainName(line.ingredient_name);
            pickNames.set(key, (pickNames.get(key) ?? 0) + 1);
          }
        }
      }
      const total = counts.none + counts.one + counts.pick;
      // If the 20 most repeated unknown names were decided once (each
      // decision is remembered), how many lines would still need a pick?
      const top20 = [...pickNames.values()]
        .sort((a, b) => b - a)
        .slice(0, 20)
        .reduce((sum, n) => sum + n, 0);
      return {
        lines: total,
        no_click: counts.none,
        one_click_proposal: counts.one,
        needs_pick_or_create: counts.pick,
        distinct_names_needing_pick: pickNames.size,
        needs_pick_after_top_20_decided: counts.pick - top20,
      };
    }

    const dishes = tally(blocks.dishes);
    const subs = tally(blocks.subRecipes);
    console.log(
      "REAL-FILE VALIDAR " +
        JSON.stringify({
          dish_blocks: blocks.dishes.length,
          dishes,
          sub_recipe_blocks: blocks.subRecipes.length,
          subs,
        })
    );
    expect(dishes.lines).toBeGreaterThan(0);
  });

  it("prefills dish drafts from the catalog only (suggestions)", async () => {
    const buffer = readFileSync(path as string);
    const { read, observations } = readCatalogFromBuffer(buffer);
    const confirmed: Record<string, { unit: "oz" | "lb" | "unit" | "g" }> = {};
    for (const row of read!.rows) {
      if (row.status === "check_unit" && row.unit) {
        confirmed[row.key] = { unit: row.unit };
      }
    }
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await applyPriceCatalog({
      repo,
      companyId: "co-real",
      userId: "u-real",
      currency: "USD",
      filename: "real-workbook-Abril-2026.xlsx",
      read: read!,
      observations,
      decisions: { rows: confirmed, conflicts: {} },
    });

    const blocks = collectWorkbookCandidateBlocks({ buffer, lang: "es" });
    // Each dish block stands in for a POS product with the same name.
    const products = blocks.dishes.map((block, index) => ({
      odoo_product_id: index + 1,
      odoo_name: block.name,
      net_sales: 1000 - index,
    }));
    const result = await runRecipeSuggestions({
      companyId: "co-real",
      products,
      candidateBlocks: blocks.all,
      repo,
      ai: {
        classifyTab: async () => ({ type: "ignore", confidence: 0.2 }),
        mapColumns: async () => ({}),
        proposeRecipe: async (product, candidates) =>
          proposeRecipeHeuristic({ product, candidateBlocks: candidates }),
      },
      currency: "USD",
      filename: "real-workbook.xlsx",
      limit: products.length,
      lang: "es",
    });

    type Line = {
      pending: boolean;
      unit_cost: number | null;
      excel_unit_cost: number | null;
      flags: string[];
      unit_question: unknown;
      ingredient_match: string | null;
      sub_recipe_match: string | null;
    };
    const suggested = result.items.filter((i) => i.result === "sugerido");
    const lines = suggested.flatMap((i) => (i.evidence.lines as Line[]) ?? []);
    const inputs = store.recipeVersions.reduce(
      (n, v) => n + v.inputs.length,
      0
    );
    const aggregates = {
      products: products.length,
      drafts_created: suggested.length,
      no_suggestion: result.sin_sugerencia,
      lines: lines.length,
      lines_added_to_recipe: inputs,
      to_ingredient: lines.filter((l) => l.ingredient_match).length,
      to_existing_preparation: lines.filter((l) => l.sub_recipe_match).length,
      unresolved: lines.filter((l) => l.flags.includes("pendiente_ingrediente"))
        .length,
      unit_questions: lines.filter((l) => l.unit_question).length,
      unreadable_unit: lines.filter(
        (l) => l.flags.includes("pendiente_unidad") && !l.unit_question
      ).length,
      excel_price_used_as_cost: lines.filter((l) => l.unit_cost !== null)
        .length,
      drafts_with_nothing_pending: suggested.filter((i) => !i.pending).length,
      preparations: result.preparations,
    };
    console.log("REAL-FILE PREFILL " + JSON.stringify(aggregates));

    // Preparaciones: what approving each preparation draft unlocks, with
    // every dish weighted the same (no POS sales offline).
    const children = new Map<string, string[]>();
    for (const v of store.componentRecipeVersions) {
      children.set(
        v.component_id,
        v.inputs.flatMap((i) => (i.component_id ? [i.component_id] : []))
      );
    }
    const dishes = store.recipeVersions.map((v, index) => ({
      odoo_product_id: index + 1,
      net_sales: 1,
      component_ids: v.inputs.flatMap((i) =>
        i.component_id ? [i.component_id] : []
      ),
    }));
    const impact = preparationImpact({
      dishes,
      children,
      totalNetSales: dishes.length,
    });
    const ranked = [...impact.entries()].sort(
      (a, b) => b[1].dishes - a[1].dishes
    );
    const reach = (n: number) => {
      const top = new Set(ranked.slice(0, n).map(([id]) => id));
      return dishes.filter((d) => {
        const stack = [...d.component_ids];
        const seen = new Set<string>();
        while (stack.length) {
          const id = stack.pop()!;
          if (seen.has(id)) continue;
          seen.add(id);
          if (top.has(id)) return true;
          stack.push(...(children.get(id) ?? []));
        }
        return false;
      }).length;
    };
    console.log(
      "REAL-FILE PREPARACIONES " +
        JSON.stringify({
          dish_drafts: dishes.length,
          dishes_using_a_preparation: dishes.filter(
            (d) => d.component_ids.length > 0
          ).length,
          preparations_used_by_dishes: impact.size,
          most_dishes_for_one_preparation: ranked[0]?.[1].dishes ?? 0,
          dishes_touched_by_top_5: reach(5),
          dishes_touched_by_top_10: reach(10),
        })
    );
    expect(aggregates.excel_price_used_as_cost).toBe(0);
  });
});
