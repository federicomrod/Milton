import { describe, expect, it, vi } from "vitest";
import { calculateMenuItemCost } from "@/lib/restaurant/costing";
import type { CostingData } from "@/lib/restaurant/costing";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import {
  approveReviewItem,
  buildImportHeadline,
  importCostWorkbook,
  layoutKeyForSheet,
  normalizeCostTabType,
  undoCostImportBatch,
} from "@/lib/restaurant/cost-workbook";
import type { WorkbookAi } from "@/lib/restaurant/cost-workbook";
import { inferDateFromName } from "@/lib/restaurant/cost-workbook/date";
import {
  assertWorkbookLimits,
  MAX_WORKBOOK_TABS,
  WorkbookLimitError,
} from "@/lib/restaurant/cost-workbook/limits";
import { shouldUseWorkbookImport } from "@/lib/restaurant/cost-workbook/sheets";
import {
  convertUnitPriceStr,
  convertUnitStr,
  normalizeUnit,
} from "@/lib/restaurant/units";
import { validateCostImportColumns } from "@/lib/restaurant/cost-import";
import { buildLosRanchosCostWorkbook } from "../fixtures/cost-workbook-los-ranchos";
import * as XLSX from "xlsx";
import type { CostWorkbookCostEntry } from "@/lib/restaurant/cost-workbook/types";
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
        ...bind("moneda", "currency"),
        ...bind("currency", "currency"),
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
      "Saved 6, updated 0 from 3 tabs. 2 need a look. 0 skipped."
    );
    expect(result.imported_count).toBe(6);
    expect(result.saved_count).toBe(6);
    expect(result.review_count).toBe(2);
    expect(result.skipped_count).toBe(0);
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

  it("reuses saved mappings only for tabs that passed sanity", async () => {
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
    expect(store.mappings.map((m) => m.tab_name).sort()).toEqual(
      ["Lista de precios", "RECETA Carne Asada", "Vegetales"].sort()
    );
    expect(store.mappings.some((m) => m.tab_name === "Carnes")).toBe(false);

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

    const classified = ai.classifyTab.mock.calls.map(
      (call) => (call[0] as { sheetName: string }).sheetName
    );
    expect(classified).toEqual(["Carnes"]);
    expect(second.mapping_source).toBe("mixed");
    expect(store.costEntries).toHaveLength(12);
    expect(second.costs_updated).toBe(0);
    expect(second.saved_count).toBe(6);
  });

  it("undo removes one batch's cost rows and auto-created ingredients", async () => {
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
    expect(store.ingredients.length).toBe(6);

    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.deleted).toBe(6);
    expect(store.costEntries).toHaveLength(0);
    expect(store.ingredients).toHaveLength(0);
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
    expect(
      buildImportHeadline({
        saved: 303,
        updated: 9,
        tabs: 14,
        review: 9,
        skipped: 2,
      })
    ).toBe("Saved 303, updated 9 from 14 tabs. 9 need a look. 2 skipped.");
  });
});

function csvImportEntry(
  partial: Partial<CostWorkbookCostEntry> &
    Pick<CostWorkbookCostEntry, "ingredient_id">
): CostWorkbookCostEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    company_id: COMPANY,
    ingredient_id: partial.ingredient_id,
    supplier_id: partial.supplier_id ?? "sup-csv",
    source_type: "import",
    source_id: null,
    cost_date: partial.cost_date ?? "2026-04-01",
    quantity: partial.quantity ?? 2,
    unit: partial.unit ?? "lb",
    total_cost: partial.total_cost ?? 99,
    unit_cost: partial.unit_cost ?? 49.5,
    normalized_unit: partial.normalized_unit ?? "lb",
    normalized_unit_cost: partial.normalized_unit_cost ?? 49.5,
    currency: "USD",
    notes: null,
    created_at: "2026-04-01T00:00:00.000Z",
  };
}

function buildTwoTabSameIngredientWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
      ["Carne para asar", 4.8, 0.3, ""],
    ]),
    "Lista"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Nombre", "Unidad", "Costo", "Cantidad", "Total"],
      ["Carne para asar", "lb", 5.5, 1, 5.5],
      ["TOTAL", "", "", "", 5.5],
    ]),
    "Carnes"
  );
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

function buildCurrencyWorkbook(): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Nombre", "Unidad", "Costo", "Cantidad", "Total", "Moneda"],
      ["Cebolla", "kg", 1.8, 5, 9, "MXN"],
    ]),
    "Vegetales"
  );
  return Buffer.from(
    XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
  );
}

describe("workbook import blockers", () => {
  it("keeps April and May costs when the same workbook is imported for both months", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const april = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    const may = await importCostWorkbook({
      companyId: COMPANY,
      filename: "Costos_Los Ranchos_Mayo-2026.xlsx",
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    expect(april.file_month).toBe("2026-04-01");
    expect(may.file_month).toBe("2026-05-01");
    expect(store.costEntries).toHaveLength(12);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-04"))
    ).toHaveLength(6);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-05"))
    ).toHaveLength(6);
    expect(may.costs_updated).toBe(0);
    expect(may.saved_count).toBe(6);
  });

  it("leaves an old CSV import row untouched", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-pollo",
      name: "Pollo entero",
      default_unit: "lb",
      current_unit_cost: 9,
      currency: "USD",
    });
    store.costEntries.push(
      csvImportEntry({
        ingredient_id: "ing-pollo",
        supplier_id: "sup-csv",
        total_cost: 99,
      })
    );
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    const csv = store.costEntries.find((e) => e.source_id === null);
    expect(csv?.total_cost).toBe(99);
    expect(csv?.supplier_id).toBe("sup-csv");
    expect(
      store.costEntries.filter((e) => e.ingredient_id === "ing-pollo")
    ).toHaveLength(2);
  });

  it("dedupes the same ingredient on two tabs of one file and counts skipped", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildTwoTabSameIngredientWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    expect(store.costEntries).toHaveLength(1);
    expect(store.costEntries[0]?.unit_cost).toBeCloseTo(5.5);
    expect(result.saved_count).toBe(1);
    expect(result.skipped_count).toBe(2);
    expect(result.review_count).toBe(0);
    expect(result.headline).toBe(
      "Saved 1, updated 0 from 2 tabs. 0 need a look. 2 skipped."
    );
  });

  it("undo restores the previous cost and removes auto-created ingredients", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-carne",
      name: "Carne para asar",
      default_unit: "lb",
      current_unit_cost: 10,
      currency: "USD",
    });
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(
      store.ingredients.find((i) => i.id === "ing-carne")?.current_unit_cost
    ).toBeCloseTo(4.8);

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook({ carneLb: 6 }),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(
      store.ingredients.find((i) => i.id === "ing-carne")?.current_unit_cost
    ).toBeCloseTo(6);
    expect(second.costs_updated).toBeGreaterThan(0);

    const undoneSecond = await undoCostImportBatch(
      repo,
      COMPANY,
      second.batch_id
    );
    expect(undoneSecond.ok).toBe(true);
    expect(
      store.ingredients.find((i) => i.id === "ing-carne")?.current_unit_cost
    ).toBeCloseTo(4.8);
    const carneRow = store.costEntries.find(
      (e) => e.ingredient_id === "ing-carne"
    );
    expect(carneRow?.unit_cost).toBeCloseTo(4.8);
    expect(carneRow?.source_id).toBe(first.batch_id);

    const undoneFirst = await undoCostImportBatch(
      repo,
      COMPANY,
      first.batch_id
    );
    expect(undoneFirst.ok).toBe(true);
    expect(
      store.ingredients.find((i) => i.id === "ing-carne")?.current_unit_cost
    ).toBe(10);
    expect(store.costEntries.some((e) => e.ingredient_id === "ing-carne")).toBe(
      false
    );
    expect(store.ingredients.map((i) => i.name)).toEqual(["Carne para asar"]);
  });

  it("blocks approving a review item after its batch was undone", async () => {
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
    const reviewId = store.reviewItems[0]?.id;
    expect(reviewId).toBeTruthy();

    await undoCostImportBatch(repo, COMPANY, result.batch_id);
    const approved = await approveReviewItem(
      repo,
      COMPANY,
      reviewId,
      "USD",
      {}
    );
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/undone/i);
    expect(store.costEntries).toHaveLength(0);
  });

  it("sends a unit-conversion failure to review and keeps headline counts exact", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-carne",
      name: "Carne para asar",
      default_unit: "unit",
      current_unit_cost: 1,
      currency: "USD",
    });
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    const unitFailure = store.reviewItems.find((r) =>
      r.reason.includes("Cannot convert unit")
    );
    expect(unitFailure).toBeTruthy();
    expect(store.costEntries.some((e) => e.ingredient_id === "ing-carne")).toBe(
      false
    );
    expect(
      result.saved_count + result.review_count + result.skipped_count
    ).toBe(8);
    expect(result.saved_count).toBe(store.costEntries.length);
    expect(result.review_count).toBe(store.reviewItems.length);
    expect(result.headline).toBe(
      `Saved ${result.saved_count}, updated ${result.costs_updated} from ${result.tab_count} tabs. ${result.review_count} need a look. ${result.skipped_count} skipped.`
    );
    expect(result.review_count).toBe(3);
    expect(result.saved_count).toBe(5);
  });

  it("rejects non-numeric approve body fields", async () => {
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
    const reviewId = store.reviewItems[0]?.id;
    const approved = await approveReviewItem(repo, COMPANY, reviewId, "USD", {
      quantity: "2" as unknown as number,
    });
    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toMatch(/number/i);
  });

  it("reports a per-row currency mismatch like the CSV path", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildCurrencyWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(result.saved_count).toBe(0);
    expect(store.reviewItems.some((r) => r.reason.includes("MXN"))).toBe(true);
  });
});

describe("workbook import nits", () => {
  it("uses a layout key that includes the sheet type", () => {
    const headers = ["Nombre", "Unidad", "Costo"];
    expect(layoutKeyForSheet(headers, "recipe")).not.toBe(
      layoutKeyForSheet(headers, "category_cost")
    );
  });

  it("does not treat a string that merely contains cost as a tab type", () => {
    expect(normalizeCostTabType("category_cost")).toBe("category_cost");
    expect(normalizeCostTabType("costos")).toBe("category_cost");
    expect(normalizeCostTabType("customer_cost_center")).toBeNull();
    expect(normalizeCostTabType("ingredient_costing_export")).toBeNull();
  });

  it("rejects oversized workbooks with a plain message", () => {
    expect(() =>
      assertWorkbookLimits({
        tabCount: MAX_WORKBOOK_TABS + 1,
        rowsPerSheet: [1],
        cellCount: 10,
      })
    ).toThrow(WorkbookLimitError);
    try {
      assertWorkbookLimits({
        tabCount: MAX_WORKBOOK_TABS + 1,
        rowsPerSheet: [1],
        cellCount: 10,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(WorkbookLimitError);
      expect((err as Error).message).toContain("Maximum is 40");
    }
  });

  it("sets maxDuration on the upload route", async () => {
    const src = await import("fs").then((fs) =>
      fs.readFileSync("app/api/restaurant/costs/upload/route.ts", "utf8")
    );
    expect(src).toContain("export const maxDuration = 300");
  });
});
