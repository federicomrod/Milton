import { describe, expect, it } from "vitest";
import {
  resetCompanyCostData,
  resetConfirmationMatches,
} from "@/lib/restaurant/cost-workbook";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";
import type { CostWorkbookCostEntry } from "@/lib/restaurant/cost-workbook/types";

const COMPANY_A = "co-ranchos";
const COMPANY_B = "co-lavara";

function costEntry(
  companyId: string,
  ingredientId: string,
  sourceType: CostWorkbookCostEntry["source_type"]
): Omit<CostWorkbookCostEntry, "id" | "created_at"> {
  return {
    company_id: companyId,
    ingredient_id: ingredientId,
    supplier_id: null,
    source_type: sourceType,
    source_id: sourceType === "import" ? "batch-1" : null,
    cost_date: "2026-04-01",
    quantity: 1,
    unit: "lb",
    total_cost: 4.8,
    unit_cost: 4.8,
    normalized_unit: "lb",
    normalized_unit_cost: 4.8,
    currency: "USD",
    notes: null,
  };
}

describe("resetCompanyCostData", () => {
  it("resets only the requested company and leaves handmade menu items", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);

    const [ingA, ingAManual] = await repo.createIngredients([
      {
        companyId: COMPANY_A,
        name: "Carne ranchos",
        defaultUnit: "lb",
        currentUnitCost: 4.8,
        currency: "USD",
      },
      {
        companyId: COMPANY_A,
        name: "Tomate ranchos",
        defaultUnit: "lb",
        currentUnitCost: 1.2,
        currency: "USD",
      },
    ]);
    const [ingB] = await repo.createIngredients([
      {
        companyId: COMPANY_B,
        name: "Carne lavara",
        defaultUnit: "lb",
        currentUnitCost: 5,
        currency: "USD",
      },
    ]);

    await repo.insertCostEntries([
      costEntry(COMPANY_A, ingA.id, "import"),
      costEntry(COMPANY_A, ingAManual.id, "manual"),
      costEntry(COMPANY_B, ingB.id, "import"),
    ]);

    const importedMenuA = await repo.createMenuItem({
      companyId: COMPANY_A,
      name: "Imported taco",
      currency: "USD",
      sourceId: "batch-a",
    });
    const importedMenuB = await repo.createMenuItem({
      companyId: COMPANY_B,
      name: "Imported burger",
      currency: "USD",
      sourceId: "batch-b",
    });
    store.menuItems.push({
      id: "menu-hand-a",
      name: "Handmade ranchos plate",
      source_type: null,
      source_id: null,
    });
    store.companyByEntityId["menu-hand-a"] = COMPANY_A;

    await repo.createRecipe({
      companyId: COMPANY_A,
      menuItemId: importedMenuA.id,
      name: "Imported taco",
      sourceId: "batch-a",
      inputs: [
        {
          input_type: "ingredient",
          ingredient_id: ingA.id,
          component_id: null,
          quantity: 1,
          unit: "lb",
          notes: null,
        },
      ],
    });
    await repo.createRecipe({
      companyId: COMPANY_B,
      menuItemId: importedMenuB.id,
      name: "Imported burger",
      sourceId: "batch-b",
      inputs: [
        {
          input_type: "ingredient",
          ingredient_id: ingB.id,
          component_id: null,
          quantity: 1,
          unit: "lb",
          notes: null,
        },
      ],
    });

    const componentA = await repo.createComponent({
      companyId: COMPANY_A,
      name: "Salsa ranchos",
      outputUnit: "oz",
      sourceId: "batch-a",
    });
    await repo.createComponent({
      companyId: COMPANY_B,
      name: "Salsa lavara",
      outputUnit: "oz",
      sourceId: "batch-b",
    });

    const [mapA] = await repo.createPosMappings([
      {
        companyId: COMPANY_A,
        rawPosItemName: "TACO",
        menuItemId: importedMenuA.id,
      },
    ]);
    const [mapB] = await repo.createPosMappings([
      {
        companyId: COMPANY_B,
        rawPosItemName: "BURGER",
        menuItemId: importedMenuB.id,
      },
    ]);
    store.posMappings.push({
      id: "map-hand-a",
      raw_pos_item_name: "HAND PLATE",
      menu_item_id: "menu-hand-a",
      match_type: "manual",
    });
    store.companyByEntityId["map-hand-a"] = COMPANY_A;

    store.supplierLinks.push({
      id: "link-a",
      company_id: COMPANY_A,
      supplier_id: "sup-a",
      ingredient_id: ingA.id,
      supplier_item_name: "Carne",
      supplier_sku: null,
      preferred: true,
    });
    store.supplierLinks.push({
      id: "link-b",
      company_id: COMPANY_B,
      supplier_id: "sup-b",
      ingredient_id: ingB.id,
      supplier_item_name: "Carne",
      supplier_sku: null,
      preferred: true,
    });

    await repo.createBatch({
      companyId: COMPANY_A,
      filename: "ranchos.xlsx",
      fileMonth: "2026-04-01",
      currency: "USD",
      importedCount: 1,
      reviewCount: 0,
      tabSummaries: [],
      mappingSource: "ai",
    });
    await repo.createBatch({
      companyId: COMPANY_B,
      filename: "lavara.xlsx",
      fileMonth: "2026-04-01",
      currency: "USD",
      importedCount: 1,
      reviewCount: 0,
      tabSummaries: [],
      mappingSource: "ai",
    });

    const summary = await resetCompanyCostData(repo, COMPANY_A);

    expect(summary.ingredients).toBe(2);
    expect(summary.cost_entries).toBe(2);
    expect(summary.import_menu_items).toBe(1);
    expect(summary.kept_manual_menu_items).toBe(1);
    expect(summary.kept_manual_pos_mappings).toBe(1);
    expect(summary.batches_marked_undone).toBe(1);

    expect(store.ingredients.map((row) => row.id)).toEqual([ingB.id]);
    expect(store.costEntries.map((row) => row.ingredient_id)).toEqual([
      ingB.id,
    ]);
    expect(store.menuItems.map((row) => row.id).sort()).toEqual(
      ["menu-hand-a", importedMenuB.id].sort()
    );
    expect(store.recipes.map((row) => row.menu_item_id)).toEqual([
      importedMenuB.id,
    ]);
    expect(store.components.map((row) => row.id)).not.toContain(componentA.id);
    expect(store.components).toHaveLength(1);
    expect(store.posMappings.map((row) => row.id).sort()).toEqual(
      ["map-hand-a", mapB.id].sort()
    );
    expect(store.posMappings.some((row) => row.id === mapA.id)).toBe(false);
    expect(store.supplierLinks.map((row) => row.id)).toEqual(["link-b"]);
    expect(
      store.batches.find((row) => row.company_id === COMPANY_A)?.undone_at
    ).toBeTruthy();
    expect(
      store.batches.find((row) => row.company_id === COMPANY_B)?.undone_at
    ).toBeNull();
  });

  it("leaves POS sales rows untouched when cost data is reset", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const [ingA] = await repo.createIngredients([
      {
        companyId: COMPANY_A,
        name: "Carne",
        defaultUnit: "lb",
        currentUnitCost: 4.8,
        currency: "USD",
      },
    ]);
    const menu = await repo.createMenuItem({
      companyId: COMPANY_A,
      name: "Taco",
      currency: "USD",
      sourceId: "batch-a",
    });
    await repo.insertCostEntries([costEntry(COMPANY_A, ingA.id, "import")]);
    store.posSalesItems.push(
      {
        id: "sale-a",
        company_id: COMPANY_A,
        raw_item_name: "TACO",
        menu_item_id: menu.id,
      },
      {
        id: "sale-b",
        company_id: COMPANY_B,
        raw_item_name: "BURGER",
        menu_item_id: null,
      }
    );

    await resetCompanyCostData(repo, COMPANY_A);

    expect(store.ingredients).toHaveLength(0);
    expect(store.menuItems).toHaveLength(0);
    expect(store.posSalesItems).toEqual([
      {
        id: "sale-a",
        company_id: COMPANY_A,
        raw_item_name: "TACO",
        menu_item_id: menu.id,
      },
      {
        id: "sale-b",
        company_id: COMPANY_B,
        raw_item_name: "BURGER",
        menu_item_id: null,
      },
    ]);
  });

  it("accepts the restaurant name case-insensitively", () => {
    expect(resetConfirmationMatches("stage test 1", "Stage Test 1")).toBe(true);
    expect(resetConfirmationMatches("  Los Ranchos ", "Los Ranchos")).toBe(
      true
    );
    expect(resetConfirmationMatches("Lavara", "Stage Test 1")).toBe(false);
  });
});
