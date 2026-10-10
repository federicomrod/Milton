import { describe, expect, it, vi } from "vitest";
import { calculateMenuItemCost } from "@/lib/restaurant/costing";
import type { CostingData } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import {
  buildImportHeadline,
  importCostWorkbook,
  undoCostImportBatch,
} from "@/lib/restaurant/cost-workbook";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import { inferDateFromName } from "@/lib/restaurant/cost-workbook/date";
import { shouldUseWorkbookImport } from "@/lib/restaurant/cost-workbook/sheets";
import {
  convertUnitPriceStr,
  convertUnitStr,
  normalizeUnit,
} from "@/lib/restaurant/units";
import { validateCostImportColumns } from "@/lib/restaurant/cost-import";
import { buildLosRanchosCostWorkbook } from "../fixtures/cost-workbook-los-ranchos";
import {
  createMemoryCostWorkbookRepo,
  type MemoryCostWorkbookStore,
} from "./helpers/memory-cost-workbook-repo";

const COMPANY = "co-ranchos";
const FILENAME = "Costos_Los Ranchos_Abril-2026.xlsx";

function emptyStore(): MemoryCostWorkbookStore {
  return {
    ingredients: [],
    costEntries: [],
    mappings: [],
    batches: [],
    reviewItems: [],
  };
}

function mockedAi(): WorkbookAi & {
  classifyTab: ReturnType<typeof vi.fn>;
  mapColumns: ReturnType<typeof vi.fn>;
} {
  const classifyTab = vi.fn(
    async (input: { sheetName: string; headers: string[] }) => {
      const name = input.sheetName.toLowerCase();
      const headers = input.headers.map((h) => h.toLowerCase());
      if (headers.includes("item") && headers.includes("libra")) {
        return { type: "price_list" as const, confidence: 0.96 };
      }
      if (name.includes("receta") || headers.includes("ingrediente")) {
        return { type: "recipe" as const, confidence: 0.95 };
      }
      return { type: "category_cost" as const, confidence: 0.93 };
    }
  );

  const mapColumns = vi.fn(
    async (input: { tabType: string; headers: string[] }) => {
      const byNorm = new Map(
        input.headers.map((h) => [h.toLowerCase().replace(/[\s_-]+/g, ""), h])
      );
      const bind = (token: string, field: string, confidence = 0.93) => {
        const col = byNorm.get(token);
        return col ? { [field]: { column: col, confidence } } : {};
      };
      if (input.tabType === "price_list") {
        return {
          ...bind("item", "ingredient_name"),
          ...bind("libra", "price_per_lb"),
          ...bind("onza", "price_per_oz"),
          ...bind("preciounitario", "price_per_unit"),
        };
      }
      return {
        ...bind("nombre", "ingredient_name"),
        ...bind("producto", "ingredient_name"),
        ...bind("unidad", "unit"),
        ...bind("costo", "unit_price"),
        ...bind("precio", "unit_price"),
        ...bind("cantidad", "quantity"),
        ...bind("total", "total_cost"),
      };
    }
  );

  return { classifyTab, mapColumns };
}

describe("units — Spanish + lb/oz", () => {
  it("normalises libra/onza/unidad/pieza", () => {
    expect(normalizeUnit("libra")).toBe("lb");
    expect(normalizeUnit("Libras")).toBe("lb");
    expect(normalizeUnit("onza")).toBe("oz");
    expect(normalizeUnit("unidad")).toBe("unit");
    expect(normalizeUnit("pieza")).toBe("unit");
    expect(normalizeUnit("kg")).toBe("kg");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("l")).toBe("l");
    expect(normalizeUnit("ml")).toBe("ml");
  });

  it("converts lb ↔ oz and into kg/g for costing", () => {
    const oz = convertUnitStr(1, "lb", "oz");
    expect(oz.ok && oz.value).toBe(16);
    const lb = convertUnitStr(8, "oz", "lb");
    expect(lb.ok && lb.value).toBe(0.5);
    const perKg = convertUnitPriceStr(4.8, "lb", "kg");
    expect(perKg.ok).toBe(true);
    if (perKg.ok) {
      expect(perKg.value).toBeCloseTo(4.8 / 0.45359237, 5);
    }
  });
});

describe("date from filename", () => {
  it("reads Abril-2026 from the Los Ranchos filename", () => {
    expect(inferDateFromName(FILENAME)).toBe("2026-04-01");
  });
});

describe("fixed-header CSV path is unchanged", () => {
  it("still requires the English purchase columns", () => {
    const check = validateCostImportColumns([
      "ITEM",
      "LIBRA",
      "ONZA",
      "PRECIO UNITARIO",
    ]);
    expect(check.ok).toBe(false);
    expect(check.missingRequired).toEqual(
      expect.arrayContaining([
        "cost_date",
        "supplier_name",
        "ingredient_name",
        "quantity",
        "unit",
        "total_cost",
      ])
    );
    expect(shouldUseWorkbookImport(true, check.ok)).toBe(false);
    expect(shouldUseWorkbookImport(false, check.ok)).toBe(true);
  });
});

describe("smart workbook import", () => {
  it("imports the synthetic Los Ranchos workbook with AI mocked", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const ai = mockedAi();
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai,
    });

    expect(ai.classifyTab).toHaveBeenCalled();
    expect(ai.mapColumns).toHaveBeenCalled();
    expect(result.headline).toBe(
      "Imported 6 items from 3 tabs. 2 need a look."
    );
    expect(result.imported_count).toBe(6);
    expect(result.review_count).toBe(2);
    expect(result.recipe_tab_count).toBe(1);
    expect(result.default_currency).toBe("USD");
    expect(result.file_month).toBe("2026-04-01");
    expect(result.mapping_source).toBe("ai");

    const recipeTab = result.tabs.find((t) => t.type === "recipe");
    expect(recipeTab?.note).toBe("recipes, coming soon");

    const names = store.ingredients.map((i) => i.name).sort();
    expect(names).toEqual(
      [
        "Carne para asar",
        "Cebolla",
        "Lechuga",
        "Pollo entero",
        "Sal",
        "Tomate",
      ].sort()
    );
    expect(store.costEntries).toHaveLength(6);
    expect(store.costEntries.every((e) => e.currency === "USD")).toBe(true);
    expect(store.costEntries.every((e) => e.cost_date === "2026-04-01")).toBe(
      true
    );
    expect(
      store.costEntries.every((e) => e.source_id === result.batch_id)
    ).toBe(true);

    const carne = store.ingredients.find((i) => i.name === "Carne para asar");
    const carneCost = store.costEntries.find(
      (e) => e.ingredient_id === carne?.id
    );
    expect(carneCost?.unit).toBe("lb");
    expect(carneCost?.unit_cost).toBeCloseTo(4.8);
    expect(carneCost?.normalized_unit).toBe("lb");

    const reasons = store.reviewItems.map((r) => r.reason);
    expect(reasons.some((r) => r.includes("unknown unit"))).toBe(true);
    expect(reasons.some((r) => r.includes("doesn't match total"))).toBe(true);
    expect(store.reviewItems.every((r) => r.status === "pending")).toBe(true);
  });

  it("reuses the saved mapping on a second upload without calling AI", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const ai = mockedAi();
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai,
    });
    expect(first.mapping_source).toBe("ai");
    expect(store.mappings.length).toBeGreaterThan(0);

    ai.classifyTab.mockClear();
    ai.mapColumns.mockClear();

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: "Costos_Los Ranchos_Mayo-2026.xlsx",
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai,
    });

    expect(ai.classifyTab).not.toHaveBeenCalled();
    expect(ai.mapColumns).not.toHaveBeenCalled();
    expect(second.mapping_source).toBe("saved");
    expect(store.costEntries).toHaveLength(6);
    expect(second.costs_updated).toBe(6);
  });

  it("undo removes one batch's cost rows", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(store.costEntries.length).toBe(6);

    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.deleted).toBe(6);
    expect(store.costEntries).toHaveLength(0);
    expect(store.batches[0]?.undone_at).toBeTruthy();
  });

  it("computes recipe cost from the imported ingredient costs", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    const carne = store.ingredients.find((i) => i.name === "Carne para asar");
    const tomate = store.ingredients.find((i) => i.name === "Tomate");
    expect(carne && tomate).toBeTruthy();
    if (!carne || !tomate) return;

    const entriesByIngredient = new Map<string, IngredientCostEntry[]>();
    for (const e of store.costEntries) {
      const list = entriesByIngredient.get(e.ingredient_id) ?? [];
      list.push({
        ...e,
        source_type: "import",
        notes: e.notes ?? undefined,
      });
      entriesByIngredient.set(e.ingredient_id, list);
    }

    const data: CostingData = {
      ingredientsById: new Map([
        [carne.id, carne],
        [tomate.id, tomate],
      ]),
      componentsById: new Map(),
      componentRecipesByComponentId: new Map(),
      componentRecipeInputsByRecipeId: new Map(),
      menuItemsById: new Map([
        [
          "menu-1",
          {
            id: "menu-1",
            name: "Carne Asada",
            selling_price: 12,
            currency: "USD",
          },
        ],
      ]),
      menuRecipesByMenuItemId: new Map([
        ["menu-1", { id: "rec-1", menu_item_id: "menu-1", status: "active" }],
      ]),
      menuRecipeInputsByRecipeId: new Map([
        [
          "rec-1",
          [
            {
              input_type: "ingredient",
              ingredient_id: carne.id,
              component_id: null,
              quantity: 8,
              unit: "oz",
            },
            {
              input_type: "ingredient",
              ingredient_id: tomate.id,
              component_id: null,
              quantity: 2,
              unit: "oz",
            },
          ],
        ],
      ]),
      costEntriesByIngredientId: entriesByIngredient,
    };

    const cost = calculateMenuItemCost("menu-1", data);
    expect(cost.status).toBe("complete");
    // 8 oz carne = 0.5 lb × $4.80 + 2 oz tomate = 0.125 lb × $1.20
    expect(cost.cost).toBeCloseTo(0.5 * 4.8 + 0.125 * 1.2, 5);
  });

  it("builds the one-line summary the UI shows", () => {
    expect(buildImportHeadline({ imported: 312, tabs: 14, review: 9 })).toBe(
      "Imported 312 items from 14 tabs. 9 need a look."
    );
  });
});
