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
import {
  expandCandidateBlocks,
  findRecipeSource,
} from "@/lib/restaurant/cost-workbook/stored-blocks";
import { readCatalogFromBuffer } from "@/lib/restaurant/price-catalog/server";
import {
  readWorkbookSheetsFromWorkbook,
  readXlsxWorkbook,
} from "@/lib/restaurant/cost-workbook/sheets";
import { convertUnitPriceStr } from "@/lib/restaurant/units";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import { unlinkedPosProduct } from "@/lib/restaurant/pos-product-links";
import { suggestTreatment } from "@/lib/restaurant/pos-treatments";
import { wantsSuggestion } from "@/lib/restaurant/recipe-suggestion-server";
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

  it("generates the whole menu in small chunks with the same result", async () => {
    const buffer = readFileSync(path as string);
    const {
      read,
      observations,
      blocks: fileBlocks,
    } = readCatalogFromBuffer(buffer);
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
      candidateBlocks: fileBlocks,
    });
    // One upload is enough: the price list batch is the recipe source.
    const source = findRecipeSource(store.batches);
    expect(source).not.toBeNull();
    const stored = expandCandidateBlocks(source!.blocks);

    const dishes = stored.filter((b) => b.kind === "recipe");
    const products = dishes.map((block, index) => ({
      odoo_product_id: index + 1,
      odoo_name: block.name,
      net_sales: 1000 - index,
    }));
    const chunkAi = {
      classifyTab: async () => ({ type: "ignore" as const, confidence: 0.2 }),
      mapColumns: async () => ({}),
      proposeRecipe: async (
        product: (typeof products)[number],
        candidates: typeof stored
      ) => proposeRecipeHeuristic({ product, candidateBlocks: candidates }),
    };
    let offset = 0;
    let chunks = 0;
    let suggested = 0;
    let preparationsCreated = 0;
    let slowestMs = 0;
    while (offset < products.length) {
      const started = Date.now();
      const r = await runRecipeSuggestions({
        companyId: "co-real",
        products,
        candidateBlocks: expandCandidateBlocks(
          findRecipeSource(store.batches)!.blocks
        ),
        repo,
        ai: chunkAi,
        currency: "USD",
        filename: "real-workbook.xlsx",
        limit: 5,
        offset,
        lang: "es",
      });
      slowestMs = Math.max(slowestMs, Date.now() - started);
      chunks += 1;
      suggested += r.suggested;
      preparationsCreated += r.preparations?.created ?? 0;
      offset += 5;
    }
    console.log(
      "REAL-FILE CHUNKS " +
        JSON.stringify({
          products: products.length,
          chunks,
          drafts_created: suggested,
          preparation_drafts_created_in_total: preparationsCreated,
          slowest_chunk_ms_offline: slowestMs,
        })
    );
    expect(preparationsCreated).toBe(store.components.length);
  });

  it("treatments: suggestions on the file's dishes, and Generar sugerencias skips non-recipe products", async () => {
    const buffer = readFileSync(path as string);
    const {
      read,
      observations,
      blocks: fileBlocks,
    } = readCatalogFromBuffer(buffer);
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
      filename: "real-workbook.xlsx",
      read: read!,
      observations,
      decisions: { rows: confirmed, conflicts: {} },
      candidateBlocks: fileBlocks,
    });
    const stored = expandCandidateBlocks(
      findRecipeSource(store.batches)!.blocks
    );
    const dishes = stored.filter((b) => b.kind === "recipe");

    // 1. What Milton would suggest for each dish name in the file.
    const onDishes: Record<string, number> = {};
    for (const block of dishes) {
      const t = suggestTreatment({
        name: block.name,
        is_combo: false,
      }).treatment;
      onDishes[t] = (onDishes[t] ?? 0) + 1;
    }
    // 2. Catalog items that look like resale (what a reventa product picks).
    const resaleInCatalog = read!.rows.filter(
      (row) =>
        row.kind === "ingredient" &&
        suggestTreatment({ name: row.name, is_combo: false }).treatment ===
          "reventa"
    ).length;

    // 3. A POS made of the file's dishes plus two invented non-recipe
    //    products (merchandise and a combo of the two top dishes; tips
    //    never reach the product list). Amounts
    //    are invented. A person accepts every suggestion.
    const sales = dishes.flatMap((block, index) => [
      {
        company_id: "co-real",
        raw_item_name: block.name,
        quantity: 1,
        net_revenue: 1000 - index,
        gross_revenue: 1000 - index,
        source_metadata: { product_id: index + 1 },
        external_line_id: `d${index}`,
      },
    ]);
    const merchId = 9001;
    const comboId = 9002;
    sales.push(
      {
        company_id: "co-real",
        raw_item_name: "Camiseta del restaurante",
        quantity: 1,
        net_revenue: 2000,
        gross_revenue: 2000,
        source_metadata: { product_id: merchId },
        external_line_id: "tip",
      },
      {
        company_id: "co-real",
        raw_item_name: "Combo",
        quantity: 1,
        net_revenue: 0,
        gross_revenue: 0,
        source_metadata: { product_id: comboId },
        external_line_id: "combo",
      }
    );
    for (const part of [1, 2]) {
      sales.push({
        company_id: "co-real",
        raw_item_name: dishes[part - 1]!.name,
        quantity: 1,
        net_revenue: 300,
        gross_revenue: 300,
        source_metadata: { product_id: part },
        external_line_id: `combo-part-${part}`,
        combo_parent_external_line_id: "combo",
      } as (typeof sales)[number]);
    }
    const before = buildPosProductList({
      companyId: "co-real",
      sales,
      links: [],
      recipeVersions: [],
    });
    const accepted = before.products
      .filter((p) => p.suggested_treatment && !p.is_combo)
      .map((p) => ({
        ...unlinkedPosProduct({
          company_id: "co-real",
          odoo_product_id: p.odoo_product_id,
          odoo_name: p.odoo_name,
        }),
        classification: p.suggested_treatment!.treatment,
      }));
    const list = buildPosProductList({
      companyId: "co-real",
      sales,
      links: accepted,
      recipeVersions: [],
    });
    const toSuggest = list.products.filter(wantsSuggestion);
    expect(toSuggest.some((p) => p.odoo_product_id === merchId)).toBe(false);
    expect(toSuggest.some((p) => p.odoo_product_id === comboId)).toBe(false);
    expect(list.food_net_sales).toBeLessThan(list.net_sales);

    const chunkAi = {
      classifyTab: async () => ({ type: "ignore" as const, confidence: 0.2 }),
      mapColumns: async () => ({}),
      proposeRecipe: async (
        product: (typeof toSuggest)[number],
        candidates: typeof stored
      ) => proposeRecipeHeuristic({ product, candidateBlocks: candidates }),
    };
    let offset = 0;
    let drafts = 0;
    while (offset < toSuggest.length) {
      const r = await runRecipeSuggestions({
        companyId: "co-real",
        products: toSuggest,
        candidateBlocks: stored,
        repo,
        ai: chunkAi,
        currency: "USD",
        filename: "real-workbook.xlsx",
        limit: 5,
        offset,
        lang: "es",
      });
      drafts += r.suggested;
      offset += 5;
    }

    console.log(
      "REAL-FILE TREATMENTS " +
        JSON.stringify({
          dishes_in_file: dishes.length,
          suggested_treatment_for_file_dishes: onDishes,
          catalog_items_that_look_like_resale: resaleInCatalog,
          pos_products: list.products.length,
          products_for_generar_sugerencias: toSuggest.length,
          excluded_share_of_all_sales_pct:
            Math.round((list.excluded_net_sales / list.net_sales) * 1000) / 10,
          drafts_created: drafts,
        })
    );
  });

  it("Plato por plato totals (PR A): what Milton prefills and what a person still decides", async () => {
    const buffer = readFileSync(path as string);
    const tabs = readWorkbookSheetsFromWorkbook(readXlsxWorkbook(buffer));
    const {
      read,
      observations,
      blocks: fileBlocks,
    } = readCatalogFromBuffer(buffer);
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
      filename: "real-workbook.xlsx",
      read: read!,
      observations,
      decisions: { rows: confirmed, conflicts: {} },
      candidateBlocks: fileBlocks,
    });
    const stored = expandCandidateBlocks(
      findRecipeSource(store.batches)!.blocks
    );
    const dishes = stored.filter((b) => b.kind === "recipe");
    const products = dishes.map((block, index) => ({
      odoo_product_id: index + 1,
      odoo_name: block.name,
      net_sales: 1000 - index,
    }));
    const ai = {
      classifyTab: async () => ({ type: "ignore" as const, confidence: 0.2 }),
      mapColumns: async () => ({}),
      proposeRecipe: async (
        product: (typeof products)[number],
        candidates: typeof stored
      ) => proposeRecipeHeuristic({ product, candidateBlocks: candidates }),
    };
    const items: Array<{
      result: string;
      pending: boolean;
      evidence: Record<string, unknown>;
    }> = [];
    for (let offset = 0; offset < products.length; offset += 5) {
      const r = await runRecipeSuggestions({
        companyId: "co-real",
        products,
        candidateBlocks: stored,
        repo,
        ai,
        currency: "USD",
        filename: "real-workbook.xlsx",
        limit: 5,
        offset,
        lang: "es",
      });
      items.push(...r.items);
    }

    type Line = {
      pending: boolean;
      qty: number;
      unit: string;
      excel_unit_cost: number | null;
      ingredient_match: string | null;
    };
    const drafts = items.filter((i) => i.result === "sugerido");
    const lines = drafts.flatMap((i) => (i.evidence.lines as Line[]) ?? []);
    const byName = new Map(store.ingredients.map((r) => [r.name, r]));
    // Recipe lines whose catalog price agrees with the Excel line (2%).
    let comparable = 0;
    let matching = 0;
    let onConflict = 0;
    for (const line of lines) {
      if (!line.ingredient_match || line.excel_unit_cost == null) continue;
      const ing = byName.get(line.ingredient_match);
      if (!ing?.current_unit_cost || !ing.default_unit) continue;
      const price = convertUnitPriceStr(
        ing.current_unit_cost,
        ing.default_unit,
        line.unit
      );
      if (!price.ok) continue;
      comparable += 1;
      const conflicted = store.reviewItems.some(
        (r) =>
          (r.raw_values as Record<string, unknown>)?.kind === "cost_conflict" &&
          (r.raw_values as Record<string, unknown>)?.name === ing.name
      );
      if (conflicted) onConflict += 1;
      const base = Math.max(price.value, line.excel_unit_cost);
      if (
        base > 0 &&
        Math.abs(price.value - line.excel_unit_cost) / base <= 0.02
      )
        matching += 1;
    }
    const totals = {
      tabs_read: tabs.length,
      tabs_with_recipes: new Set(stored.map((b) => b.tabName)).size,
      ingredients_in_list: store.ingredients.length,
      preparations_in_list: store.components.length,
      dish_recipes_prefilled: drafts.length,
      dishes_without_a_recipe_in_file: items.filter(
        (i) => i.result !== "sugerido" && i.result !== "omitido"
      ).length,
      recipe_lines: lines.length,
      lines_prefilled_no_question: lines.filter((l) => !l.pending).length,
      lines_pending_a_decision: lines.filter((l) => l.pending).length,
      dishes_with_nothing_pending: drafts.filter((d) => !d.pending).length,
      // Needs every line resolved and priced; the cost check then runs on
      // the server (refreshEvidence). Offline it can only be counted here.
      dishes_matching_excel_within_tolerance: drafts.filter(
        (d) => !d.pending && d.evidence.excel_match === "match"
      ).length,
      lines_with_excel_price_comparable: comparable,
      lines_matching_excel_price_within_2pct: matching,
      // Differences on an ingredient with two costs in the file (price list
      // vs recipe tab): they settle when a person picks which cost to keep.
      comparable_lines_on_an_open_cost_conflict: onConflict,
      cost_conflicts_left_for_a_person: store.reviewItems.filter(
        (r) =>
          (r.raw_values as Record<string, unknown>)?.kind === "cost_conflict"
      ).length,
    };
    expect(totals.dish_recipes_prefilled).toBeGreaterThan(0);
    console.log("REAL-FILE PLATO " + JSON.stringify(totals));
  });
});
