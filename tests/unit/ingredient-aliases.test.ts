// Per-company memory of confirmed ingredient names. Synthetic data only.

import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  approveReviewItem,
  importCostWorkbook,
} from "@/lib/restaurant/cost-workbook";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import {
  classifyCostTabHeuristic,
  mapColumnsHeuristic,
} from "@/lib/restaurant/cost-workbook/ai";
import { matchExistingIngredient } from "@/lib/restaurant/recipe-costing/ingredient-match";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const COMPANY = "co-alias";

const ai: WorkbookAi = {
  proposeRecipe: async () => "sin sugerencia",
  classifyTab: async (input) => classifyCostTabHeuristic(input),
  mapColumns: async (input) => mapColumnsHeuristic(input),
};

function priceListWorkbook(names: string[]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
      ...names.map((name) => [name, 6.56, 0.41, ""]),
    ]),
    "Lista de precios"
  );
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

async function run(
  store: ReturnType<typeof emptyMemoryStore>,
  names: string[]
) {
  return importCostWorkbook({
    companyId: COMPANY,
    filename: "Lista_Abril-2026.xlsx",
    buffer: priceListWorkbook(names),
    currency: "USD",
    repo: createMemoryCostWorkbookRepo(store),
    ai,
    lang: "es",
  });
}

describe("ingredient name memory", () => {
  it("holds a typo, remembers the person's confirmation, and applies it next time", async () => {
    const store = emptyMemoryStore();
    store.ingredients.push({
      id: "ing-oliva",
      name: "Aceite de oliva",
      default_unit: "oz",
      current_unit_cost: 0.41,
      currency: "USD",
    });
    const repo = createMemoryCostWorkbookRepo(store);

    await run(store, ["Aceite de oliba"]);
    const held = store.reviewItems.find((r) =>
      r.reason.startsWith("Posible coincidencia")
    );
    expect(held).toBeTruthy();
    expect(held?.raw_values.typed_name).toBe("Aceite de oliba");
    expect(store.aliases).toHaveLength(0);

    const approved = await approveReviewItem(
      repo,
      COMPANY,
      held!.id,
      "USD",
      {
        ingredient_name: "Aceite de oliva",
        unit: "oz",
        quantity: 1,
        total_cost: 0.41,
      },
      "user-1"
    );
    expect(approved.ok).toBe(true);
    expect(store.aliases).toEqual([
      expect.objectContaining({
        company_id: COMPANY,
        alias_key: "ACEITE DE OLIBA",
        ingredient_id: "ing-oliva",
        created_by: "user-1",
      }),
    ]);
    // No new ingredient was created for the typo.
    expect(store.ingredients.map((i) => i.name)).toEqual(["Aceite de oliva"]);

    // Next upload: the same typo is applied, not asked about again.
    store.reviewItems.length = 0;
    await run(store, ["Aceite de oliba"]);
    expect(
      store.reviewItems.some((r) => r.reason.startsWith("Posible coincidencia"))
    ).toBe(false);
    expect(store.ingredients.map((i) => i.name)).toEqual(["Aceite de oliva"]);
  });

  it("never lets one company's memory touch another's", async () => {
    const store = emptyMemoryStore();
    store.ingredients.push({
      id: "ing-oliva",
      name: "Aceite de oliva",
      default_unit: "oz",
      current_unit_cost: 0.41,
      currency: "USD",
    });
    store.aliases.push({
      company_id: "other-company",
      alias_key: "ACEITE DE OLIBA",
      alias_name: "Aceite de oliba",
      ingredient_id: "ing-oliva",
      created_by: null,
    });
    await run(store, ["Aceite de oliba"]);
    expect(
      store.reviewItems.some((r) => r.reason.startsWith("Posible coincidencia"))
    ).toBe(true);
  });

  it("still approves when the alias table is not there yet", async () => {
    const store = emptyMemoryStore();
    store.ingredients.push({
      id: "ing-oliva",
      name: "Aceite de oliva",
      default_unit: "oz",
      current_unit_cost: 0.41,
      currency: "USD",
    });
    const base = createMemoryCostWorkbookRepo(store);
    const repo = {
      ...base,
      upsertIngredientAlias: async () => {
        throw new Error('relation "ingredient_aliases" does not exist');
      },
    };
    await run(store, ["Aceite de oliba"]);
    const held = store.reviewItems.find((r) =>
      r.reason.startsWith("Posible coincidencia")
    )!;
    const approved = await approveReviewItem(
      repo,
      COMPANY,
      held.id,
      "USD",
      {
        ingredient_name: "Aceite de oliva",
        unit: "oz",
        quantity: 1,
        total_cost: 0.41,
      },
      "user-1"
    );
    expect(approved.ok).toBe(true);
  });

  it("a remembered alias counts as an exact match in the picker", () => {
    const catalog = [
      { id: "i1", name: "Empanizador", default_unit: "lb" },
      { id: "i2", name: "Harina", default_unit: "lb" },
    ];
    expect(matchExistingIngredient("Empanizaor", catalog).kind).toBe(
      "possible"
    );
    const aliases = new Map([["empanizaor", "i1"]]);
    const hit = matchExistingIngredient("Empanizaor", catalog, aliases);
    expect(hit.kind).toBe("exact");
    if (hit.kind === "exact") expect(hit.ingredient.id).toBe("i1");
    // An alias pointing at a deleted ingredient is ignored.
    expect(
      matchExistingIngredient(
        "Empanizaor",
        catalog,
        new Map([["empanizaor", "gone"]])
      ).kind
    ).toBe("possible");
  });

  it("refuses to approve a cost conflict through the generic route", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const batch = await repo.createBatch({
      companyId: COMPANY,
      filename: "x.xlsx",
      fileMonth: null,
      currency: "USD",
      importedCount: 0,
      reviewCount: 1,
      tabSummaries: [],
      mappingSource: "heuristic",
    });
    const [item] = await repo.insertReviewItems([
      {
        company_id: COMPANY,
        batch_id: batch.id,
        tab_name: "Lista",
        row_index: 3,
        reason: "Dos costos para X. Confirma cuál usar.",
        raw_values: { kind: "cost_conflict" },
        suggested: null,
        status: "pending",
      },
    ]);
    const result = await approveReviewItem(repo, COMPANY, item.id, "USD", {});
    expect(result.ok).toBe(false);
  });
});
