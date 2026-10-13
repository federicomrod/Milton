// Preparation drafts from sub-recipe blocks. Synthetic data only.

import { describe, expect, it } from "vitest";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook";
import {
  emptyUndoSnapshot,
  type GroupedRecipe,
} from "@/lib/restaurant/cost-workbook/types";
import {
  PREPARATION_DRAFT_KIND,
  prefillPreparations,
} from "@/lib/restaurant/recipe-costing/prefill-preparations";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const COMPANY = "co-1";

function block(
  name: string,
  lines: Array<[string, number, string, number?]>,
  extra: Partial<GroupedRecipe> = {}
): GroupedRecipe {
  return {
    name,
    tabName: "SUB",
    kind: "sub_recipe",
    output_quantity: 10,
    output_unit: "oz",
    lines: lines.map(([ingredient_name, quantity, unit, cost], index) => ({
      tabName: "SUB",
      rowIndex: index + 3,
      recipeName: name,
      ingredient_name,
      quantity,
      unit,
      raw: cost != null ? { "Costo Unitario": cost } : {},
    })),
    ...extra,
  };
}

const ingredients = [
  { id: "i-tomate", name: "Tomate", default_unit: "oz", unit_cost: 0.04 },
  { id: "i-sal", name: "Sal", default_unit: "oz", unit_cost: 0.01 },
];

async function run(blocks: GroupedRecipe[], store = emptyMemoryStore()) {
  const repo = createMemoryCostWorkbookRepo(store);
  const changes = emptyUndoSnapshot();
  const batch = await repo.createBatch({
    companyId: COMPANY,
    filename: "x.xlsx",
    fileMonth: null,
    currency: "USD",
    importedCount: 0,
    reviewCount: 0,
    tabSummaries: [],
    mappingSource: "heuristic",
  });
  const result = await prefillPreparations({
    repo,
    companyId: COMPANY,
    batchId: batch.id,
    blocks,
    ingredients,
    aliases: new Map(),
    changes,
  });
  await repo.updateBatchSnapshot(COMPANY, batch.id, changes);
  return { store, repo, result, batch };
}

describe("prefillPreparations", () => {
  it("creates in-review drafts with catalog lines only, never an Excel price", async () => {
    const { store, result } = await run([
      block(
        "Salsa roja",
        [
          ["Tomate", 8, "ONZA", 0.9],
          ["Sal", 1, "ONZA"],
        ],
        { yield_assumed: false }
      ),
    ]);
    expect(result.summary).toMatchObject({
      created: 1,
      lines: 2,
      lines_added: 2,
    });
    const comp = store.components.find((c) => c.name === "Salsa roja")!;
    const versions = store.componentRecipeVersions.filter(
      (v) => v.component_id === comp.id
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      status: "in_review",
      output_quantity: 10,
      output_unit: "oz",
    });
    expect(
      versions[0].inputs.map((i) => [i.ingredient_id, i.quantity, i.unit])
    ).toEqual([
      ["i-tomate", 8, "oz"],
      ["i-sal", 1, "oz"],
    ]);
    // Nothing in the inputs carries a cost at all.
    expect(JSON.stringify(versions[0].inputs)).not.toContain("0.9");
  });

  it("leaves unknown lines out and lists them for the person, with the yield to confirm", async () => {
    const { store, result } = await run([
      block(
        "Fondo",
        [
          ["Tomate", 8, "ONZA"],
          ["Hueso misterioso", 2, "LIBRA"],
        ],
        { yield_assumed: true, output_quantity: 1, output_unit: "unit" }
      ),
    ]);
    expect(result.summary).toMatchObject({
      lines_added: 1,
      yields_to_confirm: 1,
      drafts_with_open_items: 1,
    });
    const item = store.reviewItems.find(
      (r) => r.raw_values.kind === PREPARATION_DRAFT_KIND
    )!;
    expect(item.reason).toContain("Fondo");
    expect(item.reason).toContain("por confirmar");
    expect(item.raw_values.yield).toMatchObject({
      value: 1,
      unit: "unit",
      confirmed: false,
    });
    const lines = item.raw_values.lines as Array<{
      raw_name: string;
      pending: boolean;
    }>;
    expect(lines.find((l) => l.raw_name === "Hueso misterioso")?.pending).toBe(
      true
    );
  });

  it("resolves a preparation used inside another one", async () => {
    const { store } = await run([
      block("Convoy", [["Salsa roja", 2, "ONZA"]]),
      block("Salsa roja", [["Tomate", 8, "ONZA"]]),
    ]);
    const salsa = store.components.find((c) => c.name === "Salsa roja")!;
    const convoy = store.components.find((c) => c.name === "Convoy")!;
    const v = store.componentRecipeVersions.find(
      (r) => r.component_id === convoy.id
    )!;
    expect(v.inputs).toEqual([
      expect.objectContaining({
        input_type: "component",
        component_id: salsa.id,
        quantity: 2,
        unit: "oz",
      }),
    ]);
  });

  it("never touches an existing preparation, and skips names that appear twice", async () => {
    const store = emptyMemoryStore();
    store.components.push({
      id: "c-old",
      name: "SALSA ROJA",
      output_unit: "oz",
    } as (typeof store.components)[number]);
    const { result } = await run(
      [
        block("Salsa roja", [["Tomate", 1, "ONZA"]]),
        block("Gallo pinto", [["Sal", 1, "ONZA"]]),
        block("Gallo pinto", [["Sal", 2, "ONZA"]]),
      ],
      store
    );
    expect(result.summary).toMatchObject({
      created: 0,
      reused: 1,
      skipped_ambiguous: 1,
    });
    expect(store.components.map((c) => c.id)).toEqual(["c-old"]);
    expect(store.componentRecipeVersions).toHaveLength(0);
  });

  it("is undone with the batch", async () => {
    const { store, repo, batch } = await run([
      block("Salsa roja", [["Tomate", 8, "ONZA"]]),
    ]);
    expect(store.components).toHaveLength(1);
    const undone = await undoCostImportBatch(repo, COMPANY, batch.id);
    expect(undone.ok).toBe(true);
    expect(store.components).toHaveLength(0);
    expect(store.componentRecipes).toHaveLength(0);
  });
});
