// "Generar sugerencias": where the recipe blocks come from, chunks, and
// failures that never lose earlier work. Synthetic data only.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { buildRecipeSuggestionWorkbook } from "@/tests/fixtures/cost-workbook-los-ranchos";
import {
  collectWorkbookCandidateBlocks,
  proposeRecipeHeuristic,
  runRecipeSuggestions,
} from "@/lib/restaurant/cost-workbook";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook/undo";
import { findRecipeSource } from "@/lib/restaurant/cost-workbook/stored-blocks";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "@/tests/unit/helpers/memory-cost-workbook-repo";

const COMPANY = "co-sug";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const ai: WorkbookAi = {
  classifyTab: async () => ({ type: "ignore", confidence: 0.2 }),
  mapColumns: async () => ({}),
  proposeRecipe: async (product, blocks) =>
    proposeRecipeHeuristic({ product, candidateBlocks: blocks }),
};

const products = [
  { odoo_product_id: 1, odoo_name: "BISTEC TIPICO", net_sales: 400 },
  { odoo_product_id: 2, odoo_name: "SALSA DEMIGLASS PLATO", net_sales: 200 },
  { odoo_product_id: 3, odoo_name: "ROLL VEGETALES", net_sales: 150 },
  { odoo_product_id: 4, odoo_name: "CHURRASCO QUESILLO", net_sales: 80 },
];

const blocks = () =>
  collectWorkbookCandidateBlocks({
    buffer: buildRecipeSuggestionWorkbook(),
    lang: "es",
  }).all;

describe("findRecipeSource", () => {
  const batch = (
    id: string,
    created_at: string,
    withBlocks: boolean,
    undone = false
  ) => ({
    id,
    filename: `${id}.xlsx`,
    created_at,
    undone_at: undone ? "2026-10-02" : null,
    undo_snapshot: {
      candidate_blocks: withBlocks
        ? [
            {
              name: "X",
              tabName: "T",
              kind: "recipe",
              lines: [
                {
                  tabName: "T",
                  rowIndex: 3,
                  recipeName: "X",
                  ingredient_name: "Sal",
                  quantity: 1,
                  unit: "oz",
                  unit_cost: null,
                },
              ],
            },
          ]
        : [],
    },
  });

  it("skips a newer batch without blocks instead of failing", () => {
    const source = findRecipeSource([
      batch("old-upload", "2026-10-01", true),
      batch("failed-run", "2026-10-03", false),
    ]);
    expect(source?.batch.id).toBe("old-upload");
  });

  it("ignores undone batches and returns null when nothing is usable", () => {
    expect(findRecipeSource([batch("a", "2026-10-01", true, true)])).toBeNull();
    expect(findRecipeSource([])).toBeNull();
  });

  it("prefers the newest usable batch", () => {
    const source = findRecipeSource([
      batch("a", "2026-10-01", true),
      batch("b", "2026-10-02", true),
    ]);
    expect(source?.batch.id).toBe("b");
  });
});

describe("runRecipeSuggestions in chunks", () => {
  it("processes only the requested slice, top sellers first", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await runRecipeSuggestions({
      companyId: COMPANY,
      products,
      candidateBlocks: blocks(),
      repo,
      ai,
      currency: "USD",
      filename: "f.xlsx",
      limit: 2,
      offset: 0,
      lang: "es",
    });
    expect(first.items.map((i) => i.odoo_product_id)).toEqual([1, 2]);
    const second = await runRecipeSuggestions({
      companyId: COMPANY,
      products,
      candidateBlocks: blocks(),
      repo,
      ai,
      currency: "USD",
      filename: "f.xlsx",
      limit: 2,
      offset: 2,
      lang: "es",
    });
    expect(second.items.map((i) => i.odoo_product_id)).toEqual([3, 4]);
    // The second chunk reuses the preparations the first one created.
    expect(second.preparations?.created).toBe(0);
  });

  it("keeps the recipe blocks with the run, so the next chunk can use them", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products,
      candidateBlocks: blocks(),
      repo,
      ai,
      currency: "USD",
      filename: "f.xlsx",
      limit: 1,
      lang: "es",
    });
    const batch = store.batches.find((b) => b.id === result.batch_id)!;
    expect((batch.undo_snapshot.candidate_blocks ?? []).length).toBeGreaterThan(
      0
    );
    expect(findRecipeSource(store.batches)?.batch.id).toBe(result.batch_id);
  });

  it("one dish failing does not stop the others, and says why", async () => {
    const store = emptyMemoryStore();
    store.failNextRecipeCreate = "recipes_pkey";
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products,
      candidateBlocks: blocks(),
      repo,
      ai,
      currency: "USD",
      filename: "f.xlsx",
      limit: 4,
      lang: "es",
    });
    const failed = result.items.filter((i) => i.result === "omitido");
    expect(failed.length).toBe(1);
    expect(failed[0].reasons[0]).toContain("no pude preparar este plato");
    expect(result.suggested).toBeGreaterThan(0);
  });

  it("a run that stops halfway is still fully undoable", async () => {
    const store = emptyMemoryStore();
    store.failNextRecipeCreate = "recipes_pkey";
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await runRecipeSuggestions({
      companyId: COMPANY,
      products,
      candidateBlocks: blocks(),
      repo,
      ai,
      currency: "USD",
      filename: "f.xlsx",
      limit: 4,
      lang: "es",
    });
    expect(store.components.length).toBeGreaterThan(0);
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    expect(store.components).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
    expect(store.menuItems).toHaveLength(0);
  });
});

describe("route and screen guards", () => {
  it("the route pages with offset/next_offset and exports only handlers", () => {
    const src = read("app/api/restaurant/recipes/suggestions/route.ts");
    expect(src).toContain("next_offset");
    expect(src).toContain("readOffset(");
    expect(src).toContain("result.error === NO_STORED_BLOCKS_ERROR");
    const names = [
      ...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm),
    ].map((m) => m[1]);
    for (const name of names) {
      expect(["POST", "dynamic", "runtime", "maxDuration"]).toContain(name);
    }
  });

  it("the screen runs small chunks with progress and keeps earlier work on error", () => {
    const ui = read(
      "components/restaurant/recipes-costing/RecipesCostingWorkspace.tsx"
    );
    expect(ui).toContain("const SUGGESTION_CHUNK = 5;");
    expect(ui).toContain("json.next_offset == null");
    expect(ui).toContain("Preparando tus platos desde el archivo…");
    expect(ui).toContain("quedó guardado");
  });

  it("the price list upload keeps the recipe blocks too", () => {
    const route = read("app/api/restaurant/recipes/price-catalog/route.ts");
    expect(route).toContain("candidateBlocks: blocks");
    const apply = read("lib/restaurant/price-catalog/apply.ts");
    expect(apply).toContain(
      "snapshot.candidate_blocks = compactCandidateBlocks"
    );
  });
});
