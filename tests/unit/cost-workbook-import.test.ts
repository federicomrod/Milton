import { describe, expect, it, vi } from "vitest";
import {
  calculateAllComponentCosts,
  calculateMenuItemCost,
  getLatestIngredientCost,
} from "@/lib/restaurant/costing";
import type { CostingData } from "@/lib/restaurant/costing";
import { readFileSync } from "fs";
import type { IngredientCostEntry } from "@/types/restaurant-costing";
import {
  approveReviewItem,
  buildImportHeadline,
  canAutoLinkNames,
  damerauLevenshtein,
  implausiblePriceReason,
  importCostWorkbook,
  isObviousTypo,
  layoutKeyForSheet,
  mergeTypoDuplicates,
  nameMatchScore,
  normalizeCostTabType,
  resolveCatalogInput,
  resolvePriceListPrice,
  resolveSubRecipeYield,
  undoCostImportBatch,
  unitsCompatible,
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
import {
  buildLosRanchosCostWorkbook,
  buildLosRanchosKitchenUnitsWorkbook,
} from "../fixtures/cost-workbook-los-ranchos";
import * as XLSX from "xlsx";
import type {
  CostWorkbookCostEntry,
  GroupedRecipe,
} from "@/lib/restaurant/cost-workbook/types";
import { emptyUndoSnapshot } from "@/lib/restaurant/cost-workbook/types";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
  type MemoryCostWorkbookStore,
} from "./helpers/memory-cost-workbook-repo";

const COMPANY = "co-ranchos";
const FILENAME = "Costos_Los Ranchos_Abril-2026.xlsx";

function emptyStore(): MemoryCostWorkbookStore {
  return emptyMemoryStore();
}

function costingDataFromStore(store: MemoryCostWorkbookStore): CostingData {
  const entriesByIngredient = new Map<string, IngredientCostEntry[]>();
  for (const entry of store.costEntries) {
    const list = entriesByIngredient.get(entry.ingredient_id) ?? [];
    list.push({
      ...entry,
      source_type: "import",
      notes: entry.notes ?? undefined,
    });
    entriesByIngredient.set(entry.ingredient_id, list);
  }
  const componentRecipesByComponentId = new Map(
    store.componentRecipes.map((row) => [
      row.component_id,
      {
        id: row.id,
        component_id: row.component_id,
        output_quantity: row.output_quantity,
        output_unit: row.output_unit,
        status: "active",
      },
    ])
  );
  const componentRecipeInputsByRecipeId = new Map<
    string,
    CostingData["componentRecipeInputsByRecipeId"] extends Map<string, infer V>
      ? V
      : never
  >();
  for (const row of store.componentRecipeInputs) {
    const list =
      componentRecipeInputsByRecipeId.get(row.component_recipe_id) ?? [];
    list.push({
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
    });
    componentRecipeInputsByRecipeId.set(row.component_recipe_id, list);
  }
  const menuRecipesByMenuItemId = new Map(
    store.recipes.map((row) => [
      row.menu_item_id,
      { id: row.id, menu_item_id: row.menu_item_id, status: "active" },
    ])
  );
  const menuRecipeInputsByRecipeId = new Map<
    string,
    Array<{
      input_type: "ingredient" | "component";
      ingredient_id: string | null;
      component_id: string | null;
      quantity: number;
      unit: string;
    }>
  >();
  for (const row of store.recipeInputs) {
    const list = menuRecipeInputsByRecipeId.get(row.recipe_id) ?? [];
    list.push({
      input_type: row.input_type,
      ingredient_id: row.ingredient_id,
      component_id: row.component_id,
      quantity: row.quantity,
      unit: row.unit,
    });
    menuRecipeInputsByRecipeId.set(row.recipe_id, list);
  }
  const data: CostingData = {
    ingredientsById: new Map(
      store.ingredients.map((item) => [
        item.id,
        { id: item.id, name: item.name, default_unit: item.default_unit },
      ])
    ),
    componentsById: new Map(
      store.components.map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          output_unit: item.output_unit,
          status: "active",
        },
      ])
    ),
    componentRecipesByComponentId,
    componentRecipeInputsByRecipeId,
    menuItemsById: new Map(
      store.menuItems.map((item) => [
        item.id,
        {
          id: item.id,
          name: item.name,
          selling_price: 12,
          currency: "USD",
        },
      ])
    ),
    menuRecipesByMenuItemId,
    menuRecipeInputsByRecipeId,
    costEntriesByIngredientId: entriesByIngredient,
  };
  calculateAllComponentCosts(data);
  return data;
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
      if (name.includes("sub receta") || name.includes("sub_receta")) {
        return { type: "sub_recipe" as const, confidence: 0.94 };
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
          ...bind("preciounitario", "price_per_unit", 0.7),
        };
      }
      if (input.tabType === "recipe" || input.tabType === "sub_recipe") {
        return {
          ...bind("receta", "recipe_name"),
          ...bind("ingrediente", "ingredient_name"),
          ...bind("articulo", "ingredient_name"),
          ...bind("artículo", "ingredient_name"),
          ...bind("cantidad", "quantity"),
          ...bind("unidad", "unit"),
          ...bind("rendimiento", "output_quantity"),
          ...bind("unidadsalida", "output_unit"),
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

  it("recognises Latin American kitchen pack and gallon spellings", () => {
    expect(normalizeUnit("GALON")).toBe("gal");
    expect(normalizeUnit("galón")).toBe("gal");
    expect(normalizeUnit("galones")).toBe("gal");
    expect(normalizeUnit("PAQUETE")).toBe("unit");
    expect(normalizeUnit("PAQUETE (TORTILLA DE TACO 14 UNIDADES)")).toBe(
      "unit"
    );
    expect(normalizeUnit("SOBRES")).toBe("unit");
    expect(normalizeUnit("sobre")).toBe("unit");
    expect(normalizeUnit("UNIDA")).toBe("unit");
    expect(normalizeUnit("BOLSA")).toBe("unit");
    expect(normalizeUnit("CAJA")).toBe("unit");
    expect(normalizeUnit("lata")).toBe("unit");
    expect(normalizeUnit("botella")).toBe("unit");
    expect(normalizeUnit("bulto")).toBeNull();
    expect(normalizeUnit("APIO")).toBeNull();
    const galToL = convertUnitStr(1, "GALON", "l");
    expect(galToL.ok).toBe(true);
    if (galToL.ok) expect(galToL.value).toBeCloseTo(3.785411784, 6);
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
      "Saved 13, updated 0 from 5 tabs. 5 need a look. 7 skipped."
    );
    expect(result.imported_count).toBe(13);
    expect(result.saved_count).toBe(13);
    expect(result.review_count).toBe(5);
    expect(result.skipped_count).toBe(7);
    expect(result.recipe_tab_count).toBe(2);
    expect(result.menu_items_created).toBe(1);
    expect(result.recipes_created).toBe(1);
    expect(result.sub_recipes_created).toBe(3);
    expect(result.default_currency).toBe("USD");
    expect(result.file_month).toBe("2026-04-01");
    expect(result.mapping_source).toBe("ai");
    expect(
      result.review_items.some((item) => item.reason.includes("column unsure"))
    ).toBe(false);
    expect(result.skipped_reasons.map((row) => row.reason).sort()).toEqual(
      [
        "header/total row",
        "merged typo of ACEITE DE OLIVA",
        "merged typo of ADEREZO",
        "merged typo of ZANAHORIA",
        "no price",
        "prepared item / sub-recipe",
      ].sort()
    );

    const recipeTab = result.tabs.find((t) => t.type === "recipe");
    expect(recipeTab?.note).toBe("recipe");
    const subTab = result.tabs.find((t) => t.type === "sub_recipe");
    expect(subTab?.note).toBe("sub-recipe / prep item");

    const names = store.ingredients.map((i) => i.name).sort();
    expect(names).toEqual(
      [
        "ACEITE DE OLIVA",
        "ADEREZO",
        "AGUACATE",
        "AGUCATE",
        "Carne para asar",
        "Cebolla",
        "Lechuga",
        "Platano",
        "Pollo entero",
        "Sal",
        "Tomate",
        "Yuca",
        "ZANAHORIA",
      ].sort()
    );
    expect(store.menuItems.map((item) => item.name)).toEqual(["Carne Asada"]);
    expect(store.components.map((item) => item.name).sort()).toEqual(
      ["Salsa ranchera", "TOSTONES", "YUCA FRITA"].sort()
    );
    expect(store.recipes).toHaveLength(1);
    expect(store.recipeInputs).toHaveLength(4);
    expect(store.costEntries).toHaveLength(13);
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
    expect(reasons.some((r) => r.includes("implausible price"))).toBe(true);
    expect(
      reasons.some((r) => r.includes("looks like a typo of AGUACATE"))
    ).toBe(true);
    expect(store.reviewItems.every((r) => r.status === "pending")).toBe(true);

    const oliva = store.ingredients.find((i) => i.name === "ACEITE DE OLIVA");
    const olivaCost = store.costEntries.find(
      (e) => e.ingredient_id === oliva?.id
    );
    expect(olivaCost?.unit).toBe("oz");
    expect(olivaCost?.unit_cost).toBeCloseTo(0.3556);
    expect(
      store.ingredients.some((i) => /yuca frita|tostones/i.test(i.name))
    ).toBe(false);
    expect(
      store.ingredients.find((i) => i.name === "Pollo entero")?.category
    ).toBe("Carnes");
    expect(store.ingredients.find((i) => i.name === "Lechuga")?.category).toBe(
      "Vegetales"
    );
    expect(store.ingredients.find((i) => i.name === "ADEREZO")?.category).toBe(
      "Vegetales"
    );
    const zanahoria = store.ingredients.find((i) => i.name === "ZANAHORIA");
    expect(
      store.recipeInputs.some(
        (row) => row.ingredient_id === zanahoria?.id && row.quantity === 1
      )
    ).toBe(true);
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
      [
        "Lista de precios",
        "RECETA Carne Asada",
        "SUB RECETAS",
        "Vegetales",
      ].sort()
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
    expect(store.costEntries).toHaveLength(26);
    expect(second.costs_updated).toBe(0);
    expect(second.saved_count).toBe(13);
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
    expect(store.costEntries.length).toBe(13);
    expect(store.ingredients.length).toBe(13);
    expect(store.menuItems.length).toBe(1);
    expect(store.components.length).toBe(3);

    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.deleted).toBe(13);
    expect(store.costEntries).toHaveLength(0);
    expect(store.ingredients).toHaveLength(0);
    expect(store.menuItems).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
    expect(store.components).toHaveLength(0);
    expect(store.posMappings).toHaveLength(0);
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

    const data = costingDataFromStore(store);
    const menu = store.menuItems[0];
    expect(menu).toBeTruthy();
    const cost = calculateMenuItemCost(menu.id, data);
    expect(cost.status).toBe("complete");
    expect(cost.cost).toBeGreaterThan(0);
    // 8 oz carne = 0.5 lb × $4.80 + 2 oz tomate = 0.125 lb × $1.20 + salsa
    expect(cost.cost).toBeGreaterThan(0.5 * 4.8 + 0.125 * 1.2);
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
    expect(store.costEntries).toHaveLength(26);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-04"))
    ).toHaveLength(13);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-05"))
    ).toHaveLength(13);
    expect(may.costs_updated).toBe(0);
    expect(may.saved_count).toBe(13);
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
    ).toBe(25);
    expect(result.saved_count).toBe(store.costEntries.length);
    expect(result.review_count).toBe(store.reviewItems.length);
    expect(result.headline).toBe(
      `Saved ${result.saved_count}, updated ${result.costs_updated} from ${result.tab_count} tabs. ${result.review_count} need a look. ${result.skipped_count} skipped.`
    );
    expect(result.review_count).toBe(6);
    expect(result.saved_count).toBe(12);
    expect(result.skipped_count).toBe(7);
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

describe("workbook recipes, POS links, and cockpit COGS", () => {
  it("auto-saves price-list rows when only one column mapping is unsure", async () => {
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
    const priceTab = result.tabs.find((tab) => tab.type === "price_list");
    expect(priceTab?.column_mapping.price_per_unit?.confidence).toBe(0.7);
    expect(priceTab?.imported_count).toBe(10);
    expect(priceTab?.review_count).toBe(2);
    expect(
      result.review_items.filter((item) =>
        item.reason.includes("column unsure")
      )
    ).toHaveLength(0);
  });

  it("links imported menu items to sample POS names and yields COGS > 0", async () => {
    const store = emptyStore();
    store.posItemNames = ["CARNE ASADA", "Hamburguesa especial"];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    expect(result.pos_links_created).toBe(1);
    expect(store.posMappings[0]?.raw_pos_item_name).toBe("CARNE ASADA");
    expect(
      result.review_items.some((item) =>
        item.reason.startsWith("POS name unsure")
      )
    ).toBe(false);

    const data = costingDataFromStore(store);
    const menu = store.menuItems[0];
    const cost = calculateMenuItemCost(menu.id, data);
    expect(cost.status).toBe("complete");
    expect(cost.cost).toBeGreaterThan(0);

    const julyUnits = 10;
    const julyRevenue = 120;
    const estimatedCogs = (cost.cost ?? 0) * julyUnits;
    const coverage = (julyRevenue / julyRevenue) * 100;
    expect(estimatedCogs).toBeGreaterThan(0);
    expect(coverage).toBeGreaterThan(0);

    const carne = store.ingredients.find(
      (item) => item.name === "Carne para asar"
    );
    expect(carne).toBeTruthy();
    if (!carne) return;
    const latest = getLatestIngredientCost(carne.id, data);
    expect(latest.cost_date).toBe("2026-04-01");
    const filtered = getLatestIngredientCost(carne.id, data, {
      asOfDate: "2026-07-31",
    });
    expect(filtered.cost_date).toBe("2026-04-01");
  });

  it("imports Latin American kitchen units into recipes, menu items, POS links, and COGS", async () => {
    const store = emptyStore();
    store.posItemNames = ["CARNE ASADA", "AGUA JAMAICA", "Ceviche Lavara"];
    store.posItemLocationIds = ["loc-ranchos", "loc-ranchos", "loc-lavara"];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosKitchenUnitsWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
      locationId: "loc-ranchos",
      brandId: "brand-ranchos",
      restaurantName: "Stage Test 1",
    });

    expect(result.tab_count).toBeGreaterThanOrEqual(6);
    expect(
      result.tabs.some((tab) => tab.name === "INDICE" && tab.type === "ignore")
    ).toBe(true);
    expect(result.restaurant_name).toBe("Stage Test 1");
    expect(result.location_id).toBe("loc-ranchos");

    const unknownUnits = result.review_items.filter((item) =>
      item.reason.startsWith("unknown unit")
    );
    expect(
      unknownUnits.some((item) =>
        /PAQUETE|GALON|SOBRES|UNIDA|BOLSA|CAJA/i.test(item.reason)
      )
    ).toBe(false);
    expect(unknownUnits.some((item) => item.reason.includes("APIO"))).toBe(
      true
    );
    expect(unknownUnits.some((item) => item.reason.includes("bulto"))).toBe(
      true
    );

    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(6);
    expect(store.components.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Salsa ranchera",
        "Agua de jamaica",
        "Tortilla taco",
        "Sopa para tacos",
        "Wantan wrap",
        "Aderezo casa",
      ])
    );
    expect(store.menuItems.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Carne Asada", "Agua Jamaica"])
    );
    expect(
      store.menuItems.every((row) => row.location_id === "loc-ranchos")
    ).toBe(true);
    expect(result.recipes_created).toBeGreaterThanOrEqual(2);
    expect(result.pos_links_created).toBe(2);
    expect(
      store.posMappings.map((row) => row.raw_pos_item_name).sort()
    ).toEqual(["AGUA JAMAICA", "CARNE ASADA"].sort());
    expect(
      store.posMappings.every((row) => row.location_id === "loc-ranchos")
    ).toBe(true);

    const data = costingDataFromStore(store);
    const carne = store.menuItems.find((row) => row.name === "Carne Asada");
    expect(carne).toBeTruthy();
    if (!carne) return;
    const cost = calculateMenuItemCost(carne.id, data);
    expect(cost.status).toBe("complete");
    expect(cost.cost).toBeGreaterThan(0);
    const julyRevenue = 120;
    const estimatedCogs = (cost.cost ?? 0) * 10;
    expect(estimatedCogs).toBeGreaterThan(0);
    expect(julyRevenue > 0 && estimatedCogs > 0).toBe(true);
  });

  it("does not overwrite a handmade recipe", async () => {
    const store = emptyStore();
    store.menuItems.push({
      id: "menu-hand",
      name: "Carne Asada",
      source_type: null,
      source_id: null,
    });
    store.recipes.push({
      id: "rec-hand",
      menu_item_id: "menu-hand",
      name: "Carne Asada",
      source_type: null,
      source_id: null,
    });
    store.recipeInputs.push({
      id: "in-hand",
      recipe_id: "rec-hand",
      input_type: "ingredient",
      ingredient_id: "ing-x",
      component_id: null,
      quantity: 99,
      unit: "lb",
      notes: null,
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
    expect(result.recipes_created).toBe(0);
    expect(result.menu_items_created).toBe(0);
    expect(
      store.recipeInputs.find((row) => row.id === "in-hand")?.quantity
    ).toBe(99);
    expect(
      result.skipped_reasons.some(
        (row) => row.reason === "handmade recipe exists"
      )
    ).toBe(true);
  });

  it("cockpit costing does not filter costs by sales month", () => {
    const src = readFileSync("lib/restaurant/profitability-server.ts", "utf8");
    expect(src).not.toMatch(/asOfDate/);
    expect(src).toContain("calculateAllMenuItemCosts(costingData)");
  });
});

describe("workbook typo merge, units, categories, prepared items", () => {
  it("matches obvious typos and compatible units only", () => {
    const cases: Array<[string, string, boolean]> = [
      ["OIVA", "OLIVA", true],
      ["ACIETE", "ACEITE", true],
      ["ACEOTE", "ACEITE", true],
      ["ADERESO", "ADEREZO", true],
      ["ZANAHORA", "ZANAHORIA", true],
      ["ARROI", "ARROZ", true],
      ["AGUCATE", "AGUACATE", true],
      ["ACEITE DE OIVA", "ACEITE DE OLIVA", true],
      ["PIMIENTA", "PIMIENTO", false],
      ["CEBOLLA", "CEBOLLIN", false],
      ["QUESO", "QUESA", false],
      ["CAMARON 21/25", "CAMARON 31/35", false],
      ["TORTILLA 15CM", "TORTILLA 18CM", false],
      ["AGUACATE", "AGUACATE HASS", false],
      ["ACEITE DE OLIVA", "ACEITE DE OLIVA EXTRA VIRGEN", false],
      ["LIMON", "LIMA", false],
      ["Tomate", "Carne para asar", false],
    ];
    for (const [left, right, expected] of cases) {
      expect(isObviousTypo(left, right), `${left} ↔ ${right}`).toBe(expected);
      expect(isObviousTypo(right, left), `${right} ↔ ${left}`).toBe(expected);
    }
    expect(damerauLevenshtein("zanahora", "zanahoria")).toBe(1);
    expect(unitsCompatible("lb", "oz")).toBe(true);
    expect(unitsCompatible("oz", "unit")).toBe(false);
  });

  it("takes the unit from the LIBRA or ONZA column the price sits in", () => {
    expect(
      resolvePriceListPrice({ priceLb: 0.3556, priceOz: null, priceUnit: null })
    ).toEqual({ ok: true, unit: "lb", unitPrice: 0.3556 });
    expect(
      resolvePriceListPrice({ priceLb: null, priceOz: 0.3556, priceUnit: null })
    ).toEqual({ ok: true, unit: "oz", unitPrice: 0.3556 });
    expect(
      resolvePriceListPrice({ priceLb: 4.8, priceOz: 0.3, priceUnit: null }).ok
    ).toBe(true);
    expect(
      resolvePriceListPrice({ priceLb: 4.8, priceOz: 4.8, priceUnit: null }).ok
    ).toBe(false);
    expect(
      resolvePriceListPrice({ priceLb: null, priceOz: null, priceUnit: 0.15 })
    ).toEqual({ ok: true, unit: "unit", unitPrice: 0.15 });
  });

  it("holds an APIO-style per-gram price and allows $0", () => {
    expect(implausiblePriceReason("Apio", "g", 0.08)).toMatch(/implausible/);
    expect(implausiblePriceReason("Apio", "gramo", 0.08)).toMatch(
      /implausible/
    );
    expect(implausiblePriceReason("AGUA", "oz", 0)).toBeNull();
    expect(implausiblePriceReason("Yuca", "oz", 0.0502)).toBeNull();
  });

  it("merges typo rows and hints when units are incompatible", () => {
    const merged = mergeTypoDuplicates(
      [
        {
          tabName: "Lista",
          rowIndex: 1,
          ingredient_name: "ZANAHORIA",
          quantity: 1,
          unit: "oz",
          total_cost: 0.0169,
          unit_price: 0.0169,
          cost_date: "2026-04-01",
          supplier_name: null,
          currency: "USD",
          notes: null,
          raw: {},
        },
        {
          tabName: "Lista",
          rowIndex: 2,
          ingredient_name: "ZANAHORA",
          quantity: 1,
          unit: "oz",
          total_cost: 0.0494,
          unit_price: 0.0494,
          cost_date: "2026-04-01",
          supplier_name: null,
          currency: "USD",
          notes: null,
          raw: {},
        },
        {
          tabName: "Lista",
          rowIndex: 3,
          ingredient_name: "AGUACATE",
          quantity: 1,
          unit: "oz",
          total_cost: 0.55,
          unit_price: 0.55,
          cost_date: "2026-04-01",
          supplier_name: null,
          currency: "USD",
          notes: null,
          raw: {},
        },
        {
          tabName: "Lista",
          rowIndex: 4,
          ingredient_name: "AGUCATE",
          quantity: 1,
          unit: "unit",
          total_cost: 0.55,
          unit_price: 0.55,
          cost_date: "2026-04-01",
          supplier_name: null,
          currency: "USD",
          notes: null,
          raw: {},
        },
      ],
      []
    );
    expect(merged.rows.map((row) => row.ingredient_name).sort()).toEqual(
      ["AGUACATE", "AGUCATE", "ZANAHORIA"].sort()
    );
    expect(merged.aliases.get("zanahora")).toBe("ZANAHORIA");
    expect(
      merged.hints.some((row) =>
        row.reason.includes("looks like a typo of AGUACATE")
      )
    ).toBe(true);
  });

  it("does not merge workbook typos into handmade Aceite / Arroz", async () => {
    const store = emptyStore();
    store.ingredients.push(
      {
        id: "ing-aceite",
        name: "Aceite",
        default_unit: "lb",
        current_unit_cost: 1,
        currency: "USD",
        category: "Aceites",
      },
      {
        id: "ing-arroz",
        name: "Arroz",
        default_unit: "lb",
        current_unit_cost: 0.4,
        currency: "USD",
        category: "Granos",
      }
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["ACIETE", 2.2, 0.1375, ""],
        ["ARROI", 0.5, 0.0313, ""],
      ]),
      "Lista de precios"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(store.ingredients.map((item) => item.name).sort()).toEqual(
      ["ACIETE", "ARROI", "Aceite", "Arroz"].sort()
    );
    expect(
      store.ingredients.find((item) => item.id === "ing-aceite")?.category
    ).toBe("Aceites");
    expect(
      store.ingredients.find((item) => item.id === "ing-aceite")?.name
    ).toBe("Aceite");
    expect(store.costEntries).toHaveLength(2);
    expect(
      result.review_items.some((item) =>
        item.reason.includes("looks like a typo of Aceite")
      )
    ).toBe(true);
    expect(
      result.review_items.some((item) =>
        item.reason.includes("looks like a typo of Arroz")
      )
    ).toBe(true);
  });

  it("does not overwrite a handmade category", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-lechuga",
      name: "Lechuga",
      default_unit: "unit",
      current_unit_cost: 0.4,
      currency: "USD",
      category: "Greens",
    });
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(
      store.ingredients.find((item) => item.id === "ing-lechuga")?.category
    ).toBe("Greens");
  });

  it("converts a previously imported prepared item and undo restores it", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-yuca-frita",
      name: "YUCA FRITA",
      default_unit: "oz",
      current_unit_cost: 0.05,
      currency: "USD",
      category: null,
    });
    store.costEntries.push({
      id: "cost-yuca-frita",
      company_id: COMPANY,
      ingredient_id: "ing-yuca-frita",
      supplier_id: null,
      source_type: "import",
      source_id: "batch-old",
      cost_date: "2026-03-01",
      quantity: 1,
      unit: "oz",
      total_cost: 0.05,
      unit_cost: 0.05,
      normalized_unit: "oz",
      normalized_unit_cost: 0.05,
      currency: "USD",
      notes: null,
      created_at: "2026-03-01T00:00:00.000Z",
    });
    store.batches.push({
      id: "batch-old",
      company_id: COMPANY,
      filename: "old.xlsx",
      file_month: "2026-03-01",
      currency: "USD",
      imported_count: 1,
      review_count: 0,
      tab_summaries: [],
      mapping_source: "ai",
      undone_at: null,
      undo_snapshot: {
        ...emptyUndoSnapshot(),
        created_ingredient_ids: ["ing-yuca-frita"],
      },
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
    expect(store.ingredients.some((item) => item.id === "ing-yuca-frita")).toBe(
      false
    );
    expect(store.components.some((item) => item.name === "YUCA FRITA")).toBe(
      true
    );
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    expect(store.ingredients.some((item) => item.id === "ing-yuca-frita")).toBe(
      true
    );
    expect(store.costEntries.some((row) => row.id === "cost-yuca-frita")).toBe(
      true
    );
    expect(store.components.some((item) => item.name === "YUCA FRITA")).toBe(
      false
    );
  });

  it("never converts a handmade ingredient into a sub-recipe", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-hand-tostones",
      name: "TOSTONES",
      default_unit: "unit",
      current_unit_cost: 1,
      currency: "USD",
      category: "Prep",
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
    expect(
      store.ingredients.find((item) => item.id === "ing-hand-tostones")?.name
    ).toBe("TOSTONES");
    expect(
      store.ingredients.find((item) => item.id === "ing-hand-tostones")
        ?.category
    ).toBe("Prep");
    expect(store.components.some((item) => item.name === "TOSTONES")).toBe(
      true
    );
    expect(
      result.review_items.some(
        (item) => item.reason === "looks like a prepared item"
      )
    ).toBe(true);
  });
});

function recipeGroup(input: {
  name: string;
  lines: Array<{ name: string; quantity: number; unit: string }>;
  output_quantity?: number | null;
  output_unit?: string | null;
}): GroupedRecipe {
  return {
    name: input.name,
    tabName: "SUB RECETAS",
    kind: "sub_recipe",
    output_quantity: input.output_quantity ?? null,
    output_unit: input.output_unit ?? null,
    lines: input.lines.map((line, rowIndex) => ({
      tabName: "SUB RECETAS",
      rowIndex,
      recipeName: input.name,
      ingredient_name: line.name,
      quantity: line.quantity,
      unit: line.unit,
      raw: {},
    })),
  };
}

describe("workbook import blockers", () => {
  it("does not auto-link containment matches that differ by a whole token", () => {
    const pairs = [
      ["AGUACATE", "AGUACATE HASS"],
      ["PIMIENTA", "PIMIENTA NEGRA"],
      ["Hamburguesa Doble", "Hamburguesa"],
      ["Margarita Fresa", "Margarita"],
    ] as const;
    for (const [left, right] of pairs) {
      expect(canAutoLinkNames(left, right), `${left} ↔ ${right}`).toBe(false);
      expect(nameMatchScore(left, right)).toBeGreaterThanOrEqual(0.55);
      expect(nameMatchScore(left, right)).toBeLessThan(0.85);
      expect(
        resolveCatalogInput(left, [{ id: "ing", name: right }], []).ok
      ).toBe(false);
    }
    expect(canAutoLinkNames("CARNE ASADA", "Carne Asada")).toBe(true);
    expect(canAutoLinkNames("AGUCATE", "AGUACATE")).toBe(true);
  });

  it("sends POS containment names to review instead of auto-linking", async () => {
    const store = emptyStore();
    store.posItemNames = [
      "Hamburguesa Doble",
      "Margarita Fresa",
      "Hamburguesa",
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Sal", "", "", 0.15],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Receta", "Ingrediente", "Cantidad", "Unidad"],
        ["Hamburguesa", "Sal", 1, "g"],
        ["Margarita", "Sal", 1, "g"],
      ]),
      "RECETAS"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(store.posMappings.map((row) => row.raw_pos_item_name)).toEqual([
      "Hamburguesa",
    ]);
    expect(result.pos_links_created).toBe(1);
    expect(
      result.review_items.some((item) =>
        item.reason.includes("Hamburguesa Doble")
      )
    ).toBe(true);
    expect(
      result.review_items.some((item) =>
        item.reason.includes("Margarita Fresa")
      )
    ).toBe(true);
  });

  it("does not auto-resolve recipe lines to a longer contained name", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-hass",
      name: "AGUACATE HASS",
      default_unit: "oz",
      current_unit_cost: 0.8,
      currency: "USD",
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Sal", "", "", 0.15],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ingrediente", "Cantidad", "Unidad"],
        ["AGUACATE", 50, "g"],
        ["Sal", 1, "g"],
      ]),
      "RECETA Guacamole"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(
      result.review_items.some((item) =>
        item.reason.includes("AGUACATE ↔ AGUACATE HASS")
      )
    ).toBe(true);
    expect(
      store.recipeInputs.some((row) => row.ingredient_id === "ing-hass")
    ).toBe(false);
  });

  it("uses mapped yield, or the sum of lines, and holds when yield is unknown", () => {
    const mapped = resolveSubRecipeYield(
      recipeGroup({
        name: "Salsa",
        output_quantity: 2,
        output_unit: "kg",
        lines: [{ name: "Tomate", quantity: 100, unit: "g" }],
      })
    );
    expect(mapped).toEqual({ ok: true, quantity: 2, unit: "kg" });

    const summed = resolveSubRecipeYield(
      recipeGroup({
        name: "Salsa ranchera",
        lines: [
          { name: "Tomate", quantity: 2, unit: "lb" },
          { name: "Cebolla", quantity: 0.5, unit: "kg" },
        ],
      })
    );
    expect(summed.ok).toBe(true);
    if (summed.ok) {
      expect(summed.unit).toBe("lb");
      expect(summed.quantity).toBeCloseTo(2 + 0.5 * (1000 / 453.59237), 2);
    }

    const unknown = resolveSubRecipeYield(
      recipeGroup({
        name: "Batter",
        lines: [
          { name: "Harina", quantity: 200, unit: "g" },
          { name: "Huevo", quantity: 2, unit: "unit" },
        ],
      })
    );
    expect(unknown).toEqual({
      ok: false,
      reason: "can't tell the yield for Batter",
    });
  });

  it("does not save a sub-recipe with a fake 1 unit yield", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Harina", 0.8, 0.05, ""],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Receta", "Ingrediente", "Cantidad", "Unidad"],
        ["Batter", "Harina", 200, "g"],
        ["Batter", "Huevo", 2, "unidad"],
      ]),
      "SUB RECETAS"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(store.components.some((item) => item.name === "Batter")).toBe(false);
    expect(
      result.review_items.some(
        (item) => item.reason === "can't tell the yield for Batter"
      )
    ).toBe(true);
  });

  it("costs a menu item as a portion of the sub-recipe yield", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Tomate", 1.2, 0.075, ""],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          "Receta",
          "Ingrediente",
          "Cantidad",
          "Unidad",
          "Rendimiento",
          "Unidad salida",
        ],
        ["Salsa base", "Tomate", 2, "kg", 2, "kg"],
      ]),
      "SUB RECETAS"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Ingrediente", "Cantidad", "Unidad"],
        ["Salsa base", 100, "g"],
      ]),
      "RECETA Taco"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(result.sub_recipes_created).toBe(1);
    expect(store.componentRecipes[0]?.output_quantity).toBe(2);
    expect(store.componentRecipes[0]?.output_unit).toBe("kg");
    const data = costingDataFromStore(store);
    const cost = calculateMenuItemCost(store.menuItems[0].id, data);
    expect(cost.status).toBe("complete");
    // 2 kg tomato at $1.20/lb. 2 kg ≈ 4.409 lb → batch ≈ $5.291.
    // 100 g is 1/20 of 2 kg → ≈ $0.2645.
    expect(cost.cost).toBeCloseTo(0.2645, 2);
  });

  it("leaves a previously imported prep item alone when a handmade recipe uses it", async () => {
    const store = emptyStore();
    store.ingredients.push({
      id: "ing-yuca-frita",
      name: "YUCA FRITA",
      default_unit: "oz",
      current_unit_cost: 0.05,
      currency: "USD",
    });
    store.costEntries.push({
      id: "cost-yuca-frita",
      company_id: COMPANY,
      ingredient_id: "ing-yuca-frita",
      supplier_id: null,
      source_type: "import",
      source_id: "batch-old",
      cost_date: "2026-03-01",
      quantity: 1,
      unit: "oz",
      total_cost: 0.05,
      unit_cost: 0.05,
      normalized_unit: "oz",
      normalized_unit_cost: 0.05,
      currency: "USD",
      notes: null,
      created_at: "2026-03-01T00:00:00.000Z",
    });
    store.batches.push({
      id: "batch-old",
      company_id: COMPANY,
      filename: "old.xlsx",
      file_month: "2026-03-01",
      currency: "USD",
      imported_count: 1,
      review_count: 0,
      tab_summaries: [],
      mapping_source: "ai",
      undone_at: null,
      undo_snapshot: {
        ...emptyUndoSnapshot(),
        created_ingredient_ids: ["ing-yuca-frita"],
      },
    });
    store.menuItems.push({
      id: "menu-hand",
      name: "Yuca plate",
      source_type: null,
      source_id: null,
    });
    store.recipes.push({
      id: "rec-hand",
      menu_item_id: "menu-hand",
      name: "Yuca plate",
      source_type: null,
      source_id: null,
    });
    store.recipeInputs.push({
      id: "in-hand",
      recipe_id: "rec-hand",
      input_type: "ingredient",
      ingredient_id: "ing-yuca-frita",
      component_id: null,
      quantity: 4,
      unit: "oz",
      notes: null,
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
    expect(store.ingredients.some((item) => item.id === "ing-yuca-frita")).toBe(
      true
    );
    expect(store.recipeInputs.some((row) => row.id === "in-hand")).toBe(true);
    expect(
      result.review_items.some(
        (item) => item.reason === "looks like a prepared item"
      )
    ).toBe(true);
  });

  it("blocks undoing an older batch after a newer import updated the same rows", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook(),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook({ carneLb: 6 }),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    const blocked = await undoCostImportBatch(repo, COMPANY, first.batch_id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toMatch(/newer import/i);
    }
    expect(store.ingredients.length).toBeGreaterThan(0);
  });

  it("reports a partial undo when a leftover recipe line blocks ingredient delete", async () => {
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
    const ingredientId = store.ingredients[0]?.id;
    expect(ingredientId).toBeTruthy();
    store.menuItems.push({
      id: "menu-later",
      name: "Later dish",
      source_type: null,
      source_id: null,
    });
    store.recipes.push({
      id: "rec-later",
      menu_item_id: "menu-later",
      name: "Later dish",
      source_type: null,
      source_id: null,
    });
    store.recipeInputs.push({
      id: "in-later",
      recipe_id: "rec-later",
      input_type: "ingredient",
      ingredient_id: ingredientId,
      component_id: null,
      quantity: 1,
      unit: "oz",
      notes: null,
    });
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(undone.partial).toBe(true);
      expect(undone.warnings?.some((row) => /ingredient/i.test(row))).toBe(
        true
      );
    }
    expect(store.ingredients.some((item) => item.id === ingredientId)).toBe(
      true
    );
    expect(store.batches[0]?.undo_snapshot.undo_errors?.length).toBeGreaterThan(
      0
    );
    expect(store.batches[0]?.undone_at).toBeTruthy();
  });
});
