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
  isMissingImportCosting036Error,
  isMissingWorkbookCostColumnsError,
  MISSING_IMPORT_COSTING_036_ES,
  MISSING_WORKBOOK_COST_MIGRATION_ES,
  assumedYieldReason,
  alignFilledDownBlockRow,
  persistWriteFailedReason,
  persistStatsFromError,
  PersistWorkbookRecipesError,
  collectCostoRestauranteBlockNames,
  collectCostoRestauranteBlocks,
  emptyRecipeNameReason,
  isPackSizeReviewReason,
  unknownIngredientReason,
  unknownUnitReason,
  unsureIngredientNameReason,
  inferredCostTotalReason,
  ambiguousNumberReason,
  dishCreatedRecipeFailedReason,
  inferRecipeMappingFromContent,
  inferRecipeMappingDetails,
  isObviousTypo,
  looksLikeCostSummaryTab,
  looksLikeDishRecipeTab,
  mappingSourceLabel,
  readNumericCell,
  sheetLooksLikeCostoRestauranteBlocks,
  TOTAL_MISMATCH_REASON,
  YIELD_ASSUMED_REASON,
  YIELD_INCONSISTENT_REASON,
  foldFooterLabel,
  footerAmount,
  footerKindFromLabel,
  handmadeRecipeExistsReason,
  layoutKeyForSheet,
  mergeTypoDuplicates,
  nameMatchScore,
  normalizeCostTabType,
  PREVIOUS_DUPLICATE_REASON,
  readWorkbookSheets,
  pickMenuItemForLocation,
  resolveCatalogInput,
  resolvePriceListPrice,
  withQty,
  resolveSubRecipeYield,
  undoCostImportBatch,
  undoAllCostImportBatches,
  listCostImportHistory,
  uniquifyHeaders,
  unitsCompatible,
  classifyCostTabHeuristic,
  formatSkipBreakdownSentence,
  refineTabClassification,
  recipeMappingHasDistinctRoles,
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
  PACK_SIZE_REVIEW_REASON,
  convertUnitPriceStr,
  convertUnitStr,
  normalizeUnit,
  parseExplicitPackSize,
  resolveUnitCell,
} from "@/lib/restaurant/units";
import {
  inspectCostImportNumber,
  parseCostImportNumber,
  validateCostImportColumns,
} from "@/lib/restaurant/cost-import";
import {
  buildLosRanchosCostWorkbook,
  buildLosRanchosKitchenUnitsWorkbook,
  buildCostoRestauranteBlockWorkbook,
  buildSharedArticuloDishWorkbook,
  buildShiftedSubRecipeWorkbook,
  buildWorkbookMatchFooterWorkbook,
  buildOrdenPortionCostWorkbook,
  buildIncompleteDishWorkbook,
  buildAssumedYieldWorkbook,
  buildConfirmedDemiglassWorkbook,
  buildAssumedDemiglassWorkbook,
  buildRealLayoutCostoRestauranteWorkbook,
  buildLeadingEmptyOrdenCommaWorkbook,
} from "../fixtures/cost-workbook-los-ranchos";
import * as XLSX from "xlsx";
import type {
  ColumnMapping,
  CostWorkbookCostEntry,
  GroupedRecipe,
} from "@/lib/restaurant/cost-workbook/types";
import { persistWorkbookRecipes } from "@/lib/restaurant/cost-workbook/persist-recipes";
import { nameKey } from "@/lib/restaurant/cost-import";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
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
      {
        id: row.id,
        menu_item_id: row.menu_item_id,
        status: "active" as const,
        source_type: row.source_type,
        workbook_cost_match: row.workbook_cost_match ?? null,
      },
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
          selling_price: item.selling_price ?? 12,
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

function costingDataFromStoreWithVersions(
  store: MemoryCostWorkbookStore
): CostingData {
  const data = costingDataFromStore(store);
  data.menuRecipeVersionsByMenuItemId = store.recipeVersions.reduce(
    (map, row) => {
      const list = map.get(row.menu_item_id) ?? [];
      list.push({
        id: row.id,
        recipe_id: row.recipe_id,
        menu_item_id: row.menu_item_id,
        version_number: row.version_number,
        status: row.status,
        effective_date: row.effective_date,
        source_type: row.source_type,
      });
      map.set(row.menu_item_id, list);
      return map;
    },
    new Map()
  );
  data.menuRecipeVersionInputsByVersionId = new Map(
    store.recipeVersions.map((row) => [row.id, row.inputs])
  );
  data.componentRecipeVersionsByComponentId =
    store.componentRecipeVersions.reduce((map, row) => {
      const list = map.get(row.component_id) ?? [];
      list.push({
        id: row.id,
        component_recipe_id: row.component_recipe_id,
        component_id: row.component_id,
        version_number: row.version_number,
        status: row.status,
        effective_date: row.effective_date,
        output_quantity: row.output_quantity,
        output_unit: row.output_unit,
        source_type: row.source_type,
      });
      map.set(row.component_id, list);
      return map;
    }, new Map());
  data.componentRecipeVersionInputsByVersionId = new Map(
    store.componentRecipeVersions.map((row) => [row.id, row.inputs])
  );
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

  return {
    classifyTab,
    mapColumns,
    proposeRecipe: async () => "sin sugerencia" as const,
  };
}

/**
 * Recipe lines never create ingredients any more: the catalog has to
 * exist first. Fixtures that exercise recipe persistence seed it from
 * the workbook's own line names, as a prior price-list import would.
 */
function seedCatalogFromWorkbook(
  store: MemoryCostWorkbookStore,
  buffer: Buffer,
  skip: readonly string[] = []
): void {
  const blocks = collectWorkbookCandidateBlocks({ buffer, lang: "es" }).all;
  const blockNames = new Set(blocks.map((block) => nameKey(block.name)));
  const skipKeys = new Set(skip.map((name) => nameKey(name)));
  const have = new Set(store.ingredients.map((row) => nameKey(row.name)));
  for (const block of blocks) {
    for (const line of block.lines) {
      const key = nameKey(line.ingredient_name);
      if (!key || have.has(key) || blockNames.has(key) || skipKeys.has(key)) {
        continue;
      }
      have.add(key);
      store.ingredients.push({
        id: `seed-${store.ingredients.length + 1}`,
        name: line.ingredient_name,
        default_unit: "oz",
        current_unit_cost: 0.1,
        currency: "USD",
      });
    }
  }
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
    expect(normalizeUnit("SOBRES")).toBe("unit");
    expect(normalizeUnit("sobre")).toBe("unit");
    expect(normalizeUnit("UNIDA")).toBe("unit");
    expect(normalizeUnit("UNIDAD")).toBe("unit");
    expect(normalizeUnit("BOLSA")).toBe("unit");
    expect(normalizeUnit("CAJA")).toBe("unit");
    expect(normalizeUnit("lata")).toBe("unit");
    expect(normalizeUnit("botella")).toBe("unit");
    expect(normalizeUnit("saco")).toBe("unit");
    expect(normalizeUnit("cubeta")).toBe("unit");
    expect(normalizeUnit("balde")).toBe("unit");
    expect(normalizeUnit("bulto")).toBeNull();
    expect(normalizeUnit("APIO")).toBeNull();
    expect(normalizeUnit("GRMO")).toBe("g");
    expect(normalizeUnit("GRAKO")).toBe("g");
    expect(normalizeUnit("GRAM0")).toBe("g");
    expect(normalizeUnit("GRAMO")).toBe("g");
    expect(normalizeUnit("GRAMOS")).toBe("g");
    expect(normalizeUnit("GRAMO(S)")).toBe("g");
    expect(normalizeUnit("GR")).toBe("g");
    expect(normalizeUnit("ONZ")).toBe("oz");
    expect(normalizeUnit("LIBRA")).toBe("lb");
    expect(normalizeUnit("LIBRAS")).toBe("lb");
    expect(normalizeUnit("LIBRA(S)")).toBe("lb");
    expect(normalizeUnit("LB")).toBe("lb");
    expect(normalizeUnit("UNIDADES")).toBe("unit");
    expect(normalizeUnit("ONZAS")).toBe("oz");
    expect(normalizeUnit("LIBRAS")).toBe("lb");
    expect(normalizeUnit("LITRO")).toBe("l");
    expect(normalizeUnit("SOBRES")).toBe("unit");
    expect(normalizeUnit("CONVOY")).toBeNull();
    expect(normalizeUnit("ORDEN")).toBeNull();
    expect(resolveUnitCell("CONVOY").ok).toBe(false);
    expect(resolveUnitCell("ORDEN").ok).toBe(false);
    expect(normalizeUnit("PIMIENTA")).toBeNull();
    expect(normalizeUnit("litra")).toBeNull();
    expect(normalizeUnit("GRANO")).toBeNull();
    expect(normalizeUnit("LITRA")).toBeNull();
    expect(normalizeUnit("GRAMA?")).toBeNull();
    expect(normalizeUnit("GRAMA")).toBeNull();
    expect(normalizeUnit("LIBRO")).toBeNull();
    expect(resolveUnitCell("GRANO").ok).toBe(false);
    expect(resolveUnitCell("LIBRO").ok).toBe(false);
    const galToL = convertUnitStr(1, "GALON", "l");
    expect(galToL.ok).toBe(true);
    if (galToL.ok) expect(galToL.value).toBeCloseTo(3.785411784, 6);
  });

  it("does not treat a pack cell with a size as a plain unit", () => {
    expect(normalizeUnit("PAQUETE (TORTILLA DE TACO 14 UNIDADES)")).toBeNull();
    expect(normalizeUnit("PAQUETE (14 UNIDADES)")).toBeNull();
    expect(normalizeUnit("BOLSA 5 LB")).toBeNull();
    expect(normalizeUnit("SACO 25 KG (ARROZ)")).toBeNull();
    expect(normalizeUnit("CAJA 12 x 500 g")).toBeNull();
    expect(normalizeUnit("CUBETA 18.9 L + 2 L")).toBeNull();
    expect(normalizeUnit("kg neto")).toBe("kg");
    expect(normalizeUnit("lb (net)")).toBe("lb");
    expect(normalizeUnit("GALÓN (US)")).toBe("gal");

    expect(
      resolveUnitCell("PAQUETE (TORTILLA DE TACO 14 UNIDADES)", "es")
    ).toEqual({
      ok: false,
      reason: PACK_SIZE_REVIEW_REASON,
    });
    expect(resolveUnitCell("SACO 25 KG (ARROZ)", "es")).toEqual({
      ok: false,
      reason: PACK_SIZE_REVIEW_REASON,
    });
    expect(resolveUnitCell("CAJA 12 x 500 g", "es")).toEqual({
      ok: false,
      reason: PACK_SIZE_REVIEW_REASON,
    });
    expect(resolveUnitCell("CUBETA 18.9 L + 2 L", "es")).toEqual({
      ok: false,
      reason: PACK_SIZE_REVIEW_REASON,
    });
    expect(resolveUnitCell("APIO")).toEqual({
      ok: false,
      reason: "unknown unit (APIO)",
    });
  });

  it("converts only fully parseable pack sizes", () => {
    expect(parseExplicitPackSize("BOLSA 5 LB")).toEqual({
      unit: "lb",
      multiplier: 5,
    });
    expect(parseExplicitPackSize("PAQUETE (14 UNIDADES)")).toEqual({
      unit: "unit",
      multiplier: 14,
    });
    expect(
      parseExplicitPackSize("PAQUETE (TORTILLA DE TACO 14 UNIDADES)")
    ).toBeNull();
    expect(parseExplicitPackSize("CAJA 12 x 500 g")).toBeNull();

    const bag = convertUnitStr(1, "BOLSA 5 LB", "lb");
    expect(bag.ok).toBe(true);
    if (bag.ok) expect(bag.value).toBe(5);
    const pack = convertUnitStr(2, "PAQUETE (14 UNIDADES)", "unit");
    expect(pack.ok).toBe(true);
    if (pack.ok) expect(pack.value).toBe(28);
    const perLb = convertUnitPriceStr(10, "BOLSA 5 LB", "lb");
    expect(perLb.ok).toBe(true);
    if (perLb.ok) expect(perLb.value).toBeCloseTo(2);
    expect(
      convertUnitStr(1, "PAQUETE (TORTILLA DE TACO 14 UNIDADES)", "unit").ok
    ).toBe(false);

    expect(resolveUnitCell("BOLSA 5 LB")).toEqual({
      ok: true,
      unit: "lb",
      canonical: "lb",
      quantityMultiplier: 5,
    });
    expect(resolveUnitCell("PAQUETE (14 UNIDADES)")).toEqual({
      ok: true,
      unit: "unit",
      canonical: "unit",
      quantityMultiplier: 14,
    });
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
      "Saved 12, updated 0 from 5 tabs. 7 need a look. 4 skipped."
    );
    expect(result.imported_count).toBe(12);
    expect(result.saved_count).toBe(12);
    expect(result.review_count).toBe(7);
    expect(result.skipped_count).toBe(4);
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
      ["header/total row", "no price", "prepared item / sub-recipe"].sort()
    );
    // Look-alike names are held for a person, never merged or saved.
    const held = result.review_items
      .filter((item) => /looks like a typo of/.test(item.reason))
      .map((item) => item.reason.replace(/\? Confirm.*$/, ""))
      .sort();
    expect(held).toEqual(
      [
        "looks like a typo of ACEITE DE OLIVA",
        "looks like a typo of ADEREZO",
        "looks like a typo of AGUACATE",
        "looks like a typo of ZANAHORIA",
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
    expect(store.costEntries).toHaveLength(12);
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
    expect(store.costEntries).toHaveLength(24);
    expect(second.costs_updated).toBe(0);
    expect(second.saved_count).toBe(12);
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
    expect(store.costEntries.length).toBe(12);
    expect(store.ingredients.length).toBe(12);
    expect(store.menuItems.length).toBe(1);
    expect(store.components.length).toBe(3);

    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(undone.deleted).toBe(12);
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

  it("keeps a recipe line with a typo pending instead of resolving it silently", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook({ typoedRecipeLine: true }),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    // The dish is not saved with a guessed ingredient, and the typo is
    // neither created as an ingredient nor aliased.
    expect(store.menuItems).toHaveLength(0);
    expect(store.ingredients.map((row) => row.name)).not.toContain("ZANAHORA");
    expect(
      result.review_items.some((item) =>
        item.reason.includes("ZANAHORA ↔ ZANAHORIA")
      )
    ).toBe(true);
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
    expect(
      buildImportHeadline({
        saved: 303,
        updated: 9,
        tabs: 14,
        review: 9,
        skipped: 2,
        lang: "es",
      })
    ).toBe(
      "Se guardaron 303, se actualizaron 9 de 14 pestañas. 9 necesitan una mirada. 2 omitidas."
    );
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
    expect(store.costEntries).toHaveLength(24);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-04"))
    ).toHaveLength(12);
    expect(
      store.costEntries.filter((e) => e.cost_date.startsWith("2026-05"))
    ).toHaveLength(12);
    expect(may.costs_updated).toBe(0);
    expect(may.saved_count).toBe(12);
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
    ).toBe(23);
    expect(result.saved_count).toBe(store.costEntries.length);
    expect(result.review_count).toBe(store.reviewItems.length);
    expect(result.headline).toBe(
      `Saved ${result.saved_count}, updated ${result.costs_updated} from ${result.tab_count} tabs. ${result.review_count} need a look. ${result.skipped_count} skipped.`
    );
    expect(result.review_count).toBe(8);
    expect(result.saved_count).toBe(11);
    expect(result.skipped_count).toBe(4);
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
    expect(priceTab?.imported_count).toBe(9);
    expect(priceTab?.review_count).toBe(3);
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
    const packSizeRows = result.review_items.filter((item) =>
      isPackSizeReviewReason(item.reason)
    );
    const packUnits = packSizeRows.map((item) => item.suggested?.unit ?? "");
    expect(packUnits).toEqual(
      expect.arrayContaining([
        "PAQUETE (TORTILLA DE TACO 14 UNIDADES)",
        "SACO 25 KG (ARROZ)",
        "CAJA 12 x 500 g",
        "CUBETA 18.9 L + 2 L",
      ])
    );
    expect(packSizeRows.length).toBeGreaterThanOrEqual(4);
    expect(
      unknownUnits.some((item) =>
        /GALON|SOBRES|UNIDA|BOLSA|CAJA/i.test(item.reason)
      )
    ).toBe(false);
    expect(
      unknownUnits.some((item) =>
        /PAQUETE \(TORTILLA DE TACO 14 UNIDADES\)/i.test(item.reason)
      )
    ).toBe(false);
    expect(unknownUnits.some((item) => item.reason.includes("APIO"))).toBe(
      true
    );
    expect(unknownUnits.some((item) => item.reason.includes("bulto"))).toBe(
      true
    );

    expect(result.sub_recipes_created).toBeGreaterThan(0);
    expect(result.recipes_created).toBeGreaterThan(0);
    expect(result.menu_items_created).toBeGreaterThan(0);
    expect(store.components.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "Salsa ranchera",
        "Agua de jamaica",
        "Sopa para tacos",
        "Wantan wrap",
        "Aderezo casa",
      ])
    );
    expect(store.components.some((row) => row.name === "Tortilla taco")).toBe(
      false
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
    const carneLb = convertUnitStr(8, "oz", "lb");
    const tomateLb = convertUnitStr(2, "oz", "lb");
    const cebollaLb = convertUnitStr(0.5, "kg", "lb");
    const salsaPortionLb = convertUnitStr(2, "oz", "lb");
    expect(carneLb.ok && tomateLb.ok && cebollaLb.ok && salsaPortionLb.ok).toBe(
      true
    );
    if (!carneLb.ok || !tomateLb.ok || !cebollaLb.ok || !salsaPortionLb.ok) {
      return;
    }
    const salsaBatch = 2 * 1.2 + cebollaLb.value * 1.8;
    const salsaYieldLb = 2 + cebollaLb.value;
    const zanahoriaOz = 0.0169;
    const expectedCost =
      carneLb.value * 4.8 +
      tomateLb.value * 1.2 +
      salsaBatch * (salsaPortionLb.value / salsaYieldLb) +
      zanahoriaOz;
    expect(cost.cost).toBeCloseTo(expectedCost, 4);
    expect(expectedCost).toBeGreaterThan(2.7);
    expect(expectedCost).toBeLessThan(2.8);
  });

  it("expands parseable pack sizes and holds mixed packs for review", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Chile", 2, 0.125, ""],
        ["Sal", "", "", 0.15],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Receta", "Ingrediente", "Cantidad", "Unidad"],
        ["Chile molido", "Chile", 1, "BOLSA 5 LB"],
        ["Sal porcion", "Sal", 1, "PAQUETE (14 UNIDADES)"],
        ["Harina suelta", "Harina", 1, "CAJA 12 x 500 g"],
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

    const chile = store.componentRecipeInputs.find((row) => row.quantity === 5);
    expect(chile?.unit).toBe("lb");
    const sal = store.componentRecipeInputs.find((row) => row.quantity === 14);
    expect(sal?.unit).toBe("unit");
    expect(store.components.map((row) => row.name).sort()).toEqual(
      ["Chile molido", "Sal porcion"].sort()
    );
    expect(
      result.review_items.some(
        (item) =>
          isPackSizeReviewReason(item.reason) &&
          item.suggested?.unit === "CAJA 12 x 500 g"
      )
    ).toBe(true);
    expect(result.sub_recipes_created).toBe(2);
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

  it("holds look-alike rows for confirmation instead of merging them", () => {
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
    // Look-alike names are held for confirmation: not saved, not aliased.
    expect(merged.rows.map((row) => row.ingredient_name).sort()).toEqual(
      ["AGUACATE", "ZANAHORIA"].sort()
    );
    expect(merged.aliases.get("zanahora")).toBeUndefined();
    expect(
      merged.held.some((row) =>
        row.reason.includes("looks like a typo of ZANAHORIA")
      )
    ).toBe(true);
    expect(
      merged.held.some((row) =>
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
    // Held for a person: neither saved under the typo nor merged.
    expect(store.ingredients.map((item) => item.name).sort()).toEqual(
      ["Aceite", "Arroz"].sort()
    );
    expect(
      store.ingredients.find((item) => item.id === "ing-aceite")?.category
    ).toBe("Aceites");
    expect(
      store.ingredients.find((item) => item.id === "ing-aceite")?.name
    ).toBe("Aceite");
    expect(store.costEntries).toHaveLength(0);
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
        (item) =>
          item.reason === "looks like a prepared item" ||
          item.reason === "parece un preparado / sub-receta"
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
        (item) =>
          item.reason === "looks like a prepared item" ||
          item.reason === "parece un preparado / sub-receta"
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

  it("undo-all walks newest to oldest so overlapping batches can both come off", async () => {
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
    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLosRanchosCostWorkbook({ carneLb: 6 }),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });

    const history = await listCostImportHistory(repo, COMPANY);
    expect(history.map((row) => row.id)).toEqual([
      second.batch_id,
      first.batch_id,
    ]);
    expect(history.every((row) => row.status === "live")).toBe(true);

    const blocked = await undoCostImportBatch(repo, COMPANY, first.batch_id);
    expect(blocked.ok).toBe(false);

    const undone = await undoAllCostImportBatches(repo, COMPANY);
    expect(undone.ok).toBe(true);
    expect(undone.undone).toBe(2);
    expect(store.costEntries).toHaveLength(0);
    expect(store.ingredients).toHaveLength(0);
    expect(store.menuItems).toHaveLength(0);
    expect(store.batches.every((batch) => batch.undone_at)).toBe(true);
    const after = await listCostImportHistory(repo, COMPANY);
    expect(after.every((row) => row.status === "undone")).toBe(true);
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

function aiMappingUnitToIngredientName(): WorkbookAi & {
  classifyTab: ReturnType<typeof vi.fn>;
  mapColumns: ReturnType<typeof vi.fn>;
} {
  const base = mockedAi();
  const mapColumns = vi.fn(
    async (input: Parameters<WorkbookAi["mapColumns"]>[0]) => {
      const mapped = await base.mapColumns(input);
      if (input.tabType !== "sub_recipe") return mapped;
      const ingredient = input.headers.find((header) =>
        /ingrediente/i.test(header)
      );
      if (!ingredient) return mapped;
      return {
        ...mapped,
        unit: { column: ingredient, confidence: 0.94 },
      };
    }
  );
  return {
    classifyTab: base.classifyTab,
    mapColumns,
    proposeRecipe: async () => "sin sugerencia" as const,
  };
}

describe("recipe mapping fallback and skip breakdown", () => {
  it("uniquifies blank and duplicate headers", () => {
    expect(
      uniquifyHeaders(["Receta", "Ingrediente", "Cantidad", "", "Costo"])
    ).toEqual(["Receta", "Ingrediente", "Cantidad", "__col_3", "Costo"]);
    expect(uniquifyHeaders(["Ingrediente", "Cantidad", "Ingrediente"])).toEqual(
      ["Ingrediente", "Cantidad", "Ingrediente_2"]
    );
  });

  it("detects unit / qty / ingredient columns from cell values", () => {
    const mapping = inferRecipeMappingFromContent([
      {
        Receta: "Chimichurri casa",
        Ingrediente: "Perejil",
        Cantidad: 80,
        __col_3: "GRMO",
        Costo: 0.02,
        Total: 1.6,
      },
      {
        Receta: "Chimichurri casa",
        Ingrediente: "APIO",
        Cantidad: 40,
        __col_3: "GRAMO",
        Costo: 0.01,
        Total: 0.4,
      },
      {
        Receta: "Pimienta molida",
        Ingrediente: "PIMIENTA",
        Cantidad: 5,
        __col_3: "GRAKO",
        Costo: 0.2,
        Total: 1,
      },
    ]);
    expect(mapping.unit?.column).toBe("__col_3");
    expect(mapping.quantity?.column).toBe("Cantidad");
    expect(mapping.ingredient_name?.column).toBe("Ingrediente");
    expect(mapping.recipe_name?.column).toBe("Receta");
  });

  it("recovers when AI maps the unit to the ingredient name", async () => {
    const store = emptyStore();
    store.posItemNames = ["CARNE ASADA"];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildShiftedSubRecipeWorkbook(),
      currency: "USD",
      repo,
      ai: aiMappingUnitToIngredientName(),
      locationId: "loc-ranchos",
      restaurantName: "Stage Test 1",
    });

    const subTab = result.tabs.find((tab) => tab.name === "SUB RECETAS 2");
    expect(subTab?.column_mapping.unit?.column).toBe("__col_3");
    expect(subTab?.column_mapping.ingredient_name?.column).toBe("Ingrediente");
    expect(subTab?.mapping_source).toBe("heuristic");

    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(2);
    expect(store.components.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Chimichurri casa", "YUCA FRITA"])
    );
    expect(result.recipes_created).toBeGreaterThanOrEqual(1);
    expect(result.menu_items_created).toBeGreaterThanOrEqual(1);
    expect(result.imported_count).toBeGreaterThan(0);

    const packRows = result.review_items.filter((item) =>
      isPackSizeReviewReason(item.reason)
    );
    expect(packRows.length).toBeGreaterThanOrEqual(1);
    expect(
      result.review_items.some((item) =>
        /unknown unit \(APIO\)/i.test(item.reason)
      )
    ).toBe(false);
    expect(
      result.review_items.some((item) =>
        /unknown unit \(GRMO|GRAKO\)/i.test(item.reason)
      )
    ).toBe(false);

    expect(result.skipped_count).toBeGreaterThan(0);
    expect(result.skipped_breakdown.previous_duplicates).toBe(0);
    expect(result.skipped_breakdown.blank_or_title).toBeGreaterThan(0);
    expect(result.skipped_plain).toMatch(/exact duplicate/i);
    expect(result.skipped_plain).toMatch(/blank or title/i);
  });

  it("does not reuse a saved mapping that now fails sanity", async () => {
    const store = emptyStore();
    const buffer = buildShiftedSubRecipeWorkbook();
    const sheets = readWorkbookSheets(buffer);
    const sub = sheets.find((sheet) => sheet.name === "SUB RECETAS 2");
    expect(sub).toBeTruthy();
    if (!sub) return;

    store.mappings.push({
      layout_key: layoutKeyForSheet(sub.headers, "sub_recipe"),
      tab_name: "SUB RECETAS 2",
      tab_type: "sub_recipe",
      column_mapping: {
        recipe_name: { column: "Receta", confidence: 0.95 },
        ingredient_name: { column: "Ingrediente", confidence: 0.95 },
        quantity: { column: "Cantidad", confidence: 0.95 },
        unit: { column: "Ingrediente", confidence: 0.95 },
      },
      header_fingerprint: sub.headerFingerprint,
      tab_confidence: 0.96,
    });

    const repo = createMemoryCostWorkbookRepo(store);
    const ai = aiMappingUnitToIngredientName();
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer,
      currency: "USD",
      repo,
      ai,
    });

    const subTab = result.tabs.find((tab) => tab.name === "SUB RECETAS 2");
    expect(subTab?.mapping_source).not.toBe("saved");
    expect(subTab?.column_mapping.unit?.column).toBe("__col_3");
    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(2);
    expect(ai.mapColumns).toHaveBeenCalled();

    const saved = store.mappings.find(
      (row) => row.tab_name === "SUB RECETAS 2"
    );
    expect(saved?.column_mapping.unit?.column).toBe("__col_3");
    expect(saved?.column_mapping.unit?.column).not.toBe("Ingrediente");
  });

  it("never persists a mapping that still fails sanity", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Receta", "Ingrediente", "Cantidad", "Unidad"],
        ["Salsa", "APIO", 1, "APIO"],
        ["Salsa", "PIMIENTA", 1, "XYZQ"],
      ]),
      "SUB RECETAS"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(store.mappings.some((row) => row.tab_name === "SUB RECETAS")).toBe(
      false
    );
  });

  it("counts previous-upload duplicates separately from blank rows", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const buffer = buildLosRanchosCostWorkbook();
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer,
      currency: "USD",
      repo,
      ai: mockedAi(),
    });
    expect(first.skipped_breakdown.previous_duplicates).toBe(0);
    expect(first.skipped_breakdown.blank_or_title).toBeGreaterThan(0);
    expect(first.skipped_plain).toMatch(
      /0 were exact duplicates of a previous upload/
    );

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer,
      currency: "USD",
      repo,
      ai: mockedAi(),
      skipDuplicates: true,
    });
    expect(second.skipped_breakdown.previous_duplicates).toBeGreaterThan(0);
    expect(
      second.skipped_reasons.some(
        (row) => row.reason === PREVIOUS_DUPLICATE_REASON
      )
    ).toBe(true);
    expect(second.skipped_plain).toMatch(/exact duplicate/i);
    expect(second.saved_count).toBe(0);
  });
});

describe("recipe mapping confidence and Spanish copy", () => {
  it("refuses to guess when quantity and cost look alike", () => {
    const mapping = inferRecipeMappingFromContent([
      {
        Receta: "Salsa",
        Ingrediente: "Perejil",
        A: 1.5,
        Unidad: "GRAMO",
        B: 1.2,
      },
      { Receta: "Salsa", Ingrediente: "Ajo", A: 2.0, Unidad: "GRAMO", B: 2.4 },
      { Receta: "Salsa", Ingrediente: "Tomate", A: 3.5, Unidad: "LB", B: 3.1 },
    ]);
    expect(mapping.quantity).toBeUndefined();
    expect(
      inferRecipeMappingDetails([
        {
          Receta: "Salsa",
          Ingrediente: "Perejil",
          A: 1.5,
          Unidad: "GRAMO",
          B: 1.2,
        },
        {
          Receta: "Salsa",
          Ingrediente: "Ajo",
          A: 2.0,
          Unidad: "GRAMO",
          B: 2.4,
        },
        {
          Receta: "Salsa",
          Ingrediente: "Tomate",
          A: 3.5,
          Unidad: "LB",
          B: 3.1,
        },
      ]).confident
    ).toBe(false);
  });

  it("does not treat a swapped cost column as quantity", () => {
    const mapping = inferRecipeMappingFromContent([
      {
        Receta: "Salsa",
        Ingrediente: "Perejil",
        Costo: 0.02,
        Unidad: "GRAMO",
        Cantidad: 80,
      },
      {
        Receta: "Salsa",
        Ingrediente: "Ajo",
        Costo: 0.05,
        Unidad: "GRAMO",
        Cantidad: 20,
      },
      {
        Receta: "Salsa",
        Ingrediente: "Tomate",
        Costo: 1.6,
        Unidad: "LB",
        Cantidad: 2,
      },
    ]);
    expect(mapping.quantity?.column).toBe("Cantidad");
    expect(mapping.unit?.column).toBe("Unidad");
    expect(mapping.ingredient_name?.column).toBe("Ingrediente");
  });

  it("treats a shared Articulo role map as invalid", () => {
    expect(
      recipeMappingHasDistinctRoles({
        recipe_name: { column: "Articulo", confidence: 0.9 },
        ingredient_name: { column: "Articulo", confidence: 0.9 },
        quantity: { column: "Cantidad", confidence: 0.9 },
        unit: { column: "Unidad Detalle", confidence: 0.9 },
      })
    ).toBe(false);
  });

  it("classifies dish tabs as recipe and cost summaries as not-recipe", () => {
    const dishRows = [
      { Articulo: "Ceviche", Cantidad: "", "Unidad Detalle": "", Costo: "" },
      {
        Articulo: "Pescado",
        Cantidad: 200,
        "Unidad Detalle": "GRAM0",
        Costo: 0.3,
      },
      { Articulo: "Nachos", Cantidad: "", "Unidad Detalle": "", Costo: "" },
      {
        Articulo: "Totopos",
        Cantidad: 100,
        "Unidad Detalle": "GRMO",
        Costo: 0.8,
      },
    ];
    expect(
      looksLikeDishRecipeTab({
        sheetName: "Entradas",
        headers: ["Articulo", "Cantidad", "Unidad Detalle", "Costo"],
        dataRows: dishRows,
      })
    ).toBe(true);
    expect(
      classifyCostTabHeuristic({
        sheetName: "Entradas",
        headers: ["Articulo", "Cantidad", "Unidad Detalle", "Costo"],
        sampleRows: dishRows,
        dataRows: dishRows,
      }).type
    ).toBe("recipe");
    expect(
      refineTabClassification({
        proposed: { type: "sub_recipe", confidence: 0.94 },
        sheetName: "Parrilladas",
        headers: ["Articulo", "Cantidad", "Unidad Detalle", "Costo"],
        dataRows: dishRows,
      }).type
    ).toBe("recipe");

    const summaryRows = [
      { Concepto: "Alquiler", Enero: 2000, Febrero: 2000, Total: 4000 },
      { Concepto: "Luz", Enero: 400, Febrero: 420, Total: 820 },
    ];
    expect(
      looksLikeCostSummaryTab({
        sheetName: "COSTOS RESTAURANTE 2026",
        headers: ["Concepto", "Enero", "Febrero", "Total"],
        dataRows: summaryRows,
      })
    ).toBe(true);
    expect(
      refineTabClassification({
        proposed: { type: "recipe", confidence: 0.9 },
        sheetName: "COSTOS RESTAURANTE 2026",
        headers: ["Concepto", "Enero", "Febrero", "Total"],
        dataRows: summaryRows,
      }).type
    ).toBe("ignore");
  });

  it("translates skip and mapping labels to LatAm Spanish", () => {
    expect(
      formatSkipBreakdownSentence(
        5,
        { previous_duplicates: 2, blank_or_title: 3, other: 0 },
        "es"
      )
    ).toBe(
      "De las 5 filas omitidas, 2 eran duplicados exactos de una carga anterior y 3 eran filas en blanco o de título."
    );
    expect(mappingSourceLabel("es", "heuristic")).toBe(
      "columnas según los valores"
    );
    expect(mappingSourceLabel("es", "mixed")).toBe("mixto");
  });
});

function aiSharedArticuloAsRecipeAndIngredient(): WorkbookAi & {
  classifyTab: ReturnType<typeof vi.fn>;
  mapColumns: ReturnType<typeof vi.fn>;
} {
  const classifyTab = vi.fn(
    async (input: { sheetName: string; headers: string[] }) => {
      const name = input.sheetName.toLowerCase();
      if (name.includes("precio") || input.headers.includes("ITEM")) {
        return { type: "price_list" as const, confidence: 0.96 };
      }
      if (name.includes("costos restaurante")) {
        return { type: "recipe" as const, confidence: 0.91 };
      }
      return { type: "sub_recipe" as const, confidence: 0.93 };
    }
  );
  const mapColumns = vi.fn(
    async (input: {
      tabType: string;
      headers: string[];
    }): Promise<ColumnMapping> => {
      const byNorm = new Map(
        input.headers.map((h) => [h.toLowerCase().replace(/[\s_-]+/g, ""), h])
      );
      const col = (token: string) => byNorm.get(token);
      if (input.tabType === "price_list") {
        return {
          ingredient_name: { column: col("item") ?? "ITEM", confidence: 0.93 },
          price_per_lb: { column: col("libra") ?? "LIBRA", confidence: 0.93 },
          price_per_oz: { column: col("onza") ?? "ONZA", confidence: 0.93 },
        };
      }
      const articulo = col("articulo") ?? col("artículo");
      return {
        recipe_name: { column: articulo ?? "Articulo", confidence: 0.94 },
        ingredient_name: { column: articulo ?? "Articulo", confidence: 0.94 },
        quantity: { column: col("cantidad") ?? "Cantidad", confidence: 0.9 },
        unit: {
          column: col("unidaddetalle") ?? col("unidad") ?? "Unidad Detalle",
          confidence: 0.9,
        },
        output_quantity: {
          column: col("cantidad") ?? "Cantidad",
          confidence: 0.7,
        },
        output_unit: {
          column: col("unidaddetalle") ?? "Unidad Detalle",
          confidence: 0.7,
        },
      };
    }
  );
  return {
    classifyTab,
    mapColumns,
    proposeRecipe: async () => "sin sugerencia" as const,
  };
}

describe("shared Articulo dish tabs and cost summary", () => {
  it("recovers dish recipes when AI maps Articulo to both roles", async () => {
    const store = emptyStore();
    store.posItemNames = ["CARNE ASADA", "CEVICHE", "NACHOS"];
    seedCatalogFromWorkbook(store, buildSharedArticuloDishWorkbook());
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildSharedArticuloDishWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      locationId: "loc-ranchos",
      restaurantName: "Stage Test 1",
      lang: "es",
    });

    const entradas = result.tabs.find((tab) => tab.name === "Entradas");
    expect(entradas?.type).toBe("recipe");
    expect(entradas?.column_mapping.recipe_name?.column).not.toBe(
      entradas?.column_mapping.ingredient_name?.column
    );
    expect(entradas?.column_mapping.ingredient_name?.column).toBe("Articulo");
    expect(entradas?.column_mapping.unit?.column).toBe("Unidad Detalle");

    const parrilladas = result.tabs.find((tab) => tab.name === "Parrilladas");
    expect(parrilladas?.type).toBe("recipe");

    const costos = result.tabs.find(
      (tab) => tab.name === "COSTOS RESTAURANTE 2026"
    );
    expect(costos?.type).toBe("ignore");
    expect(result.recipes_created).toBeGreaterThanOrEqual(1);
    expect(result.menu_items_created).toBeGreaterThanOrEqual(1);
    expect(store.menuItems.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Costilla", "Ceviche"])
    );
    expect(store.menuItems.map((row) => row.name)).not.toContain("Nachos");
    expect(
      result.review_items.some((item) =>
        /unknown unit \(GRAM0\)/i.test(item.reason)
      )
    ).toBe(false);
    expect(
      result.review_items.some(
        (item) => item.reason === PACK_SIZE_REVIEW_REASON
      )
    ).toBe(true);
    expect(result.skipped_plain).toMatch(/filas omitidas/i);
    const savedRecipeMap = store.mappings.find(
      (row) =>
        row.tab_type === "recipe" &&
        row.column_mapping.ingredient_name?.column === "Articulo"
    );
    expect(savedRecipeMap).toBeTruthy();
    expect(savedRecipeMap?.column_mapping.recipe_name?.column).not.toBe(
      "Articulo"
    );
  });

  it("does not reuse or persist a saved overlapping Articulo map", async () => {
    const store = emptyStore();
    const buffer = buildSharedArticuloDishWorkbook();
    const sheets = readWorkbookSheets(buffer);
    const entradas = sheets.find((sheet) => sheet.name === "Entradas");
    expect(entradas).toBeTruthy();
    if (!entradas) return;

    store.mappings.push({
      layout_key: layoutKeyForSheet(entradas.headers, "sub_recipe"),
      tab_name: "Entradas",
      tab_type: "sub_recipe",
      column_mapping: {
        recipe_name: { column: "Articulo", confidence: 0.95 },
        ingredient_name: { column: "Articulo", confidence: 0.95 },
        quantity: { column: "Cantidad", confidence: 0.95 },
        unit: { column: "Unidad Detalle", confidence: 0.95 },
      },
      header_fingerprint: entradas.headerFingerprint,
      tab_confidence: 0.96,
    });
    store.mappings.push({
      layout_key: layoutKeyForSheet(entradas.headers, "recipe"),
      tab_name: "Entradas",
      tab_type: "recipe",
      column_mapping: {
        recipe_name: { column: "Articulo", confidence: 0.95 },
        ingredient_name: { column: "Articulo", confidence: 0.95 },
        quantity: { column: "Cantidad", confidence: 0.95 },
        unit: { column: "Unidad Detalle", confidence: 0.95 },
      },
      header_fingerprint: entradas.headerFingerprint,
      tab_confidence: 0.96,
    });

    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer,
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
    });

    const tab = result.tabs.find((row) => row.name === "Entradas");
    expect(tab?.mapping_source).not.toBe("saved");
    expect(tab?.type).toBe("recipe");
    expect(tab?.column_mapping.recipe_name?.column).not.toBe("Articulo");
    expect(result.recipes_created).toBeGreaterThanOrEqual(1);
    expect(store.menuItems.map((row) => row.name)).not.toContain("Nachos");
    const saved = store.mappings.find(
      (row) =>
        row.tab_type === "recipe" &&
        row.column_mapping.ingredient_name?.column === "Articulo"
    );
    expect(saved?.column_mapping.ingredient_name?.column).toBe("Articulo");
    expect(saved?.column_mapping.recipe_name?.column).not.toBe("Articulo");
  });

  it("sends swapped-column recipe rows to needs-a-look and does not persist", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Receta", "Ingrediente", "Uno", "Unidad", "Dos"],
        ["Salsa", "Perejil", 1.4, "GRAMO", 1.6],
        ["Salsa", "Ajo", 2.1, "GRAMO", 1.9],
        ["Salsa", "Tomate", 3.2, "LB", 2.8],
      ]),
      "RECETA Salsa"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const ai: WorkbookAi = {
      classifyTab: async () => ({ type: "recipe", confidence: 0.95 }),
      mapColumns: async () => ({
        recipe_name: { column: "Receta", confidence: 0.9 },
        ingredient_name: { column: "Ingrediente", confidence: 0.9 },
        quantity: { column: "Uno", confidence: 0.9 },
        unit: { column: "Unidad", confidence: 0.9 },
      }),
      proposeRecipe: async () => "sin sugerencia",
    };
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai,
    });
    expect(result.recipes_created).toBe(0);
    expect(result.review_count).toBeGreaterThan(0);
    expect(
      result.review_items.some((item) =>
        /unidad|cantidad|ingrediente/i.test(item.reason)
      )
    ).toBe(true);
    expect(store.mappings.some((row) => row.tab_name === "RECETA Salsa")).toBe(
      false
    );
  });
});

describe("COSTO RESTAURANTE block layout", () => {
  it("parses banners, merged names, no-banner first block, and footers", () => {
    const sheets = readWorkbookSheets(buildCostoRestauranteBlockWorkbook());
    const sub = sheets.find((sheet) => sheet.name === "SUB RECETAS");
    expect(sub?.aoa).toBeTruthy();
    expect(sheetLooksLikeCostoRestauranteBlocks(sub?.aoa ?? [])).toBe(true);

    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      aoa: sub?.aoa ?? [],
      lang: "es",
    });
    const names = parsed.groups.map((group) => group.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "QUESO FRITO",
        "FONDO PARA SOPA DE TORTILLA",
        "FONDO DE RES",
        "DEMIGLASS",
      ])
    );
    const quesoFrito = parsed.groups.find(
      (group) => group.name === "QUESO FRITO"
    );
    expect(quesoFrito?.output_quantity).toBeCloseTo(1, 5);
    expect(quesoFrito?.output_unit).toBe("unit");
    expect(quesoFrito?.cost_total).toBeCloseTo(0.21354, 5);
    const demiglass = parsed.groups.find((group) => group.name === "DEMIGLASS");
    expect(demiglass?.output_unit).toBe("lb");
    expect(demiglass?.output_quantity).toBeCloseTo(8, 5);
    expect(demiglass?.cost_total).toBeCloseTo(2, 5);
    expect(demiglass?.price_per_lb).toBeCloseTo(0.25, 5);
    expect(demiglass?.price_per_oz).toBeCloseTo(0.015625, 5);
    expect(names).not.toEqual(expect.arrayContaining(["COSTO RESTAURANTE"]));
    expect(names).not.toEqual(
      expect.arrayContaining(["RESTAURANTE LOS RANCHOS"])
    );
    expect(names).not.toContain("Articulo");
    expect(
      parsed.groups.some((group) =>
        group.lines.some((line) => line.ingredient_name === "Articulo")
      )
    ).toBe(false);
    expect(
      parsed.review.some((item) =>
        item.reason.includes(YIELD_INCONSISTENT_REASON)
      )
    ).toBe(true);
    expect(
      parsed.review.some((item) => item.reason === PACK_SIZE_REVIEW_REASON)
    ).toBe(true);

    const salsa = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS 2",
      tabKind: "sub_recipe",
      aoa: sheets.find((sheet) => sheet.name === "SUB RECETAS 2")?.aoa ?? [],
      lang: "es",
    });
    expect(salsa.groups.map((group) => group.name)).toEqual(
      expect.arrayContaining([
        "SALSA TARTARA",
        "SALSA VERDE",
        "CHIMICHURRI",
        "GUACAMOL",
      ])
    );
    const tartara = salsa.groups.find(
      (group) => group.name === "SALSA TARTARA"
    );
    expect(tartara?.output_unit).toBe("lb");
    expect(tartara?.output_quantity).toBeCloseTo(7.55 / 0.555, 5);
    expect(readNumericCell("#######")).toBeNull();
    expect(
      tartara?.lines.some(
        (line) => line.ingredient_name === "CEBOLLA" && line.quantity === 2
      )
    ).toBe(true);

    const knownPrep = [
      ...collectCostoRestauranteBlockNames(sub?.aoa ?? []),
      ...salsa.groups.map((group) => group.name),
    ];
    const dishes = collectCostoRestauranteBlocks({
      tabName: "DE LA PARRILLA",
      tabKind: "recipe",
      aoa: sheets.find((sheet) => sheet.name === "DE LA PARRILLA")?.aoa ?? [],
      knownSubRecipeNames: knownPrep,
      lang: "es",
    });
    expect(dishes.groups.map((group) => group.name)).toEqual(
      expect.arrayContaining(["CHURRASCO TIPICO 6", "CHURRASCO TIPICO 8"])
    );
    const churrasco = dishes.groups.find(
      (group) => group.name === "CHURRASCO TIPICO 6"
    );
    expect(churrasco?.selling_price).toBeCloseTo(17.699, 3);
    expect(
      churrasco?.lines.some(
        (line) =>
          line.ingredient_name === "CONVOY ENSALADA Y CALDO" &&
          normalizeUnit(line.unit) === "portion"
      )
    ).toBe(true);
    expect(
      dishes.review.some((item) => /unknown unit \(CONVOY\)/i.test(item.reason))
    ).toBe(false);

    const especial = collectCostoRestauranteBlocks({
      tabName: "ESPECIALIDADES DE LA PARRILLA",
      tabKind: "recipe",
      aoa:
        sheets.find((sheet) => sheet.name === "ESPECIALIDADES DE LA PARRILLA")
          ?.aoa ?? [],
      knownSubRecipeNames: knownPrep,
      lang: "es",
    });
    expect(
      especial.review.some((item) => item.reason === TOTAL_MISMATCH_REASON)
    ).toBe(true);
    expect(
      especial.groups
        .find((group) => group.name === "PUYASO")
        ?.lines.some((line) => line.ingredient_name === "GUARNICION 1")
    ).toBe(true);
  });

  it("imports dish tabs as recipes and resolves CONVOY/ORDEN to sub-recipes", async () => {
    const store = emptyStore();
    store.posItemNames = ["CHURRASCO TIPICO 6", "PUYASO", "ENTRAÑA"];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildCostoRestauranteBlockWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      locationId: "loc-ranchos",
      lang: "es",
    });

    expect(result.tabs.find((tab) => tab.name === "DE LA PARRILLA")?.type).toBe(
      "recipe"
    );
    expect(result.tabs.find((tab) => tab.name === "SUB RECETAS")?.type).toBe(
      "sub_recipe"
    );
    expect(
      result.tabs.find((tab) => tab.name === "COSTOS RESTAURANTE 2026")
    ).toBeUndefined();
    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(4);
    expect(store.components.map((row) => row.name)).toEqual(
      expect.arrayContaining(["SALSA TARTARA", "CHIMICHURRI", "GUACAMOL"])
    );
    expect(store.components.map((row) => row.name)).not.toContain(
      "COSTO RESTAURANTE"
    );
    expect(
      result.review_items.some((item) =>
        /unknown unit \(CONVOY|ORDEN\)|unidad desconocida \(CONVOY|ORDEN\)/i.test(
          item.reason
        )
      )
    ).toBe(false);
    expect(
      store.components.some((component) => component.name === "GUARNICION 1")
    ).toBe(true);
    expect(
      result.review_items.some(
        (item) => item.reason === PACK_SIZE_REVIEW_REASON
      )
    ).toBe(true);
    expect(
      result.review_items.some((item) =>
        item.reason.includes(YIELD_INCONSISTENT_REASON)
      )
    ).toBe(true);
  });

  it("reads dirty Los Ranchos footers instead of storing Cantidad=0 as the total", () => {
    expect(footerKindFromLabel("COSTO TOTAL")).toBe("costo_total");
    expect(footerKindFromLabel("DEMIGLASS")).toBeNull();
    expect(footerKindFromLabel("PRECIO POR ONZA $0.015625")).toBe("precio_oz");
    expect(footerKindFromLabel("PRECIO COSTO POR UNIDAD")).toBe("precio_unit");
    expect(
      footerAmount(["COSTO TOTAL", "", 0, 0, 0.21354], {
        ingredient: 0,
        unit: 1,
        qty: 2,
        unitCost: 3,
        total: 4,
      })
    ).toBeCloseTo(0.21354, 5);
    expect(
      footerAmount(["DEMIGLASS", "PRECIO POR LIBRA", 0, 0, 0.25], {
        ingredient: 0,
        unit: 1,
        qty: 2,
        unitCost: 3,
        total: 4,
      })
    ).toBeCloseTo(0.25, 5);
    expect(footerAmount(["PRECIO POR ONZA $0.015625"])).toBeCloseTo(
      0.015625,
      5
    );
    expect(footerKindFromLabel("PRECIO POR LIBRA $0.42")).toBe("precio_lb");
    expect(footerAmount(["PRECIO POR LIBRA $0.42"])).toBeCloseTo(0.42, 5);
    expect(
      footerAmount(["DEMIGLASS", "PRECIO POR LIBRA $0.42"], {
        ingredient: 0,
        unit: 1,
        qty: 2,
        unitCost: 3,
        total: 4,
      })
    ).toBeCloseTo(0.42, 5);
  });

  it("parses PRECIO POR LIBRA $0.42 and PRECIO POR ONZA $0.015625 as yield", () => {
    const header = [
      "Articulo",
      "Unidad Detalle",
      "Cantidad",
      "Costo Unitario",
      "Total Costo",
    ];
    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      lang: "es",
      aoa: [
        ["COSTO RESTAURANTE"],
        ["FONDO PARA SOPA DE TORTILLA"],
        header,
        ["TOMATE", "LIBRA", 0.5, 0.96, 0.48],
        ["COSTO TOTAL", "", "", "", 3.36],
        ["PRECIO POR LIBRA $0.42"],
        [],
        ["COSTO RESTAURANTE"],
        ["DEMIGLASS"],
        header,
        ["HUESO", "LIBRA", 4, 0.4, 1.6],
        ["COSTO TOTAL", "", "", "", 2],
        ["PRECIO POR ONZA $0.015625"],
      ],
    });
    const fondo = parsed.groups.find(
      (group) => group.name === "FONDO PARA SOPA DE TORTILLA"
    );
    expect(fondo?.price_per_lb).toBeCloseTo(0.42, 5);
    expect(fondo?.output_unit).toBe("lb");
    expect(fondo?.output_quantity).toBeCloseTo(8, 5);
    expect(fondo?.yield_assumed).toBeFalsy();
    const demi = parsed.groups.find((group) => group.name === "DEMIGLASS");
    expect(demi?.price_per_oz).toBeCloseTo(0.015625, 6);
    expect(demi?.output_unit).toBe("oz");
    expect(demi?.output_quantity).toBeCloseTo(128, 5);
    expect(demi?.yield_assumed).toBeFalsy();
  });

  it("marks a COSTO TOTAL-only yield as assumed and always needs a look", () => {
    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      lang: "es",
      aoa: [
        ["COSTO RESTAURANTE"],
        ["QUESO FRITO"],
        [
          "Articulo",
          "Unidad Detalle",
          "Cantidad",
          "Costo Unitario",
          "Total Costo",
        ],
        ["QUESO GRATINADO", "ONZA", 1, 0.15, 0.15],
        ["COSTO TOTAL", "", "", "", 0.15],
      ],
    });
    const queso = parsed.groups.find((group) => group.name === "QUESO FRITO");
    expect(queso?.yield_assumed).toBe(true);
    expect(queso?.output_quantity).toBeCloseTo(1, 5);
    expect(queso?.output_unit).toBe("unit");
    expect(assumedYieldReason("es")).toBe(
      "Rendimiento asumido: 1 orden (el Excel solo trae COSTO TOTAL)"
    );
    expect(
      parsed.review.some(
        (item) =>
          item.reason.includes(YIELD_ASSUMED_REASON) &&
          item.reason.includes("QUESO FRITO")
      )
    ).toBe(true);
    expect(
      parsed.review.some((item) =>
        /no pude calcular el rendimiento \(QUESO FRITO\)/.test(item.reason)
      )
    ).toBe(false);
  });

  it("imports the full Los Ranchos block fixture with yields and dishes", async () => {
    // Staging 2026-10-12 (r1-staging after #160/#173), same real workbook:
    //   saved 77, review 693, skipped 473, recipes 0, sub-recipes 0, dishes 0.
    // Before this fix, dirty footers (Cantidad=0, name filled down column A,
    // "PRECIO POR ONZA $0.015625") left QUESO FRITO / DEMIGLASS with no
    // yield; persist then dropped those preps and every dish that used them.
    // After on this fixture: 10 sub-recipes, 4 recipes / dishes, 6 review
    // (pack size + FONDO DE RES inconsistent + a few unknown units).
    const store = emptyStore();
    store.posItemNames = [
      "CHURRASCO TIPICO 6",
      "DEDOS DE QUESO",
      "SALSA DEMIGLASS PLATO",
    ];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildCostoRestauranteBlockWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      locationId: "loc-ranchos",
      lang: "es",
    });

    expect(result.sub_recipes_created).toBe(10);
    expect(result.recipes_created).toBe(4);
    expect(result.menu_items_created).toBe(4);
    expect(result.review_count).toBe(6);
    expect(
      result.review_items.some((item) =>
        /no pude calcular el rendimiento \(QUESO FRITO\)/.test(item.reason)
      )
    ).toBe(false);
    expect(
      result.review_items.some((item) =>
        /no pude calcular el rendimiento \(DEMIGLASS\)/.test(item.reason)
      )
    ).toBe(false);

    const queso = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "QUESO FRITO"
      )
    );
    expect(queso?.output_quantity).toBeCloseTo(1, 5);
    expect(queso?.output_unit).toBe("unit");
    const demi = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "DEMIGLASS"
      )
    );
    expect(demi?.output_quantity).toBeCloseTo(8, 5);
    expect(demi?.output_unit).toBe("lb");
    expect(store.menuItems.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        "DEDOS DE QUESO",
        "SALSA DEMIGLASS PLATO",
        "CHURRASCO TIPICO 6",
      ])
    );
    expect(store.recipes.length).toBeGreaterThan(0);
  });

  it("saves an assumed yield in review and keeps dishes pending, not Excel matches", async () => {
    const importAssumed = async (store: MemoryCostWorkbookStore) =>
      importCostWorkbook({
        companyId: COMPANY,
        filename: FILENAME,
        buffer: buildAssumedYieldWorkbook(),
        currency: "USD",
        repo: createMemoryCostWorkbookRepo(store),
        ai: aiSharedArticuloAsRecipeAndIngredient(),
        locationId: "loc-ranchos",
        lang: "es",
      });

    const store = emptyStore();
    store.posItemNames = ["DEDOS DE QUESO"];
    const first = await importAssumed(store);

    expect(first.sub_recipes_created).toBe(1);
    expect(first.recipes_created).toBe(1);
    expect(first.menu_items_created).toBe(1);
    expect(
      first.review_items.some(
        (item) =>
          item.reason.includes(YIELD_ASSUMED_REASON) &&
          item.reason.includes("QUESO FRITO")
      )
    ).toBe(true);

    const quesoVersions = store.componentRecipeVersions.filter((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "QUESO FRITO"
      )
    );
    expect(quesoVersions.length).toBeGreaterThan(0);
    expect(quesoVersions.every((row) => row.status === "in_review")).toBe(true);

    const dedos = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    expect(dedos).toBeTruthy();
    expect(dedos?.workbook_cost_match).not.toBe("match");
    expect(first.recipe_match?.dishes_matched ?? 0).toBe(0);
    expect(
      first.recipe_match?.mismatches.some(
        (row) => row.name === "DEDOS DE QUESO"
      )
    ).toBe(false);

    const costed = calculateMenuItemCost(
      store.menuItems.find((row) => row.name === "DEDOS DE QUESO")!.id,
      costingDataFromStoreWithVersions(store)
    );
    expect(costed.status).not.toBe("complete");
    expect(costed.cost).toBeNull();

    const second = await importAssumed(store);
    expect(second.sub_recipes_created).toBe(0);
    expect(
      store.componentRecipeVersions
        .filter((row) =>
          store.components.some(
            (component) =>
              component.id === row.component_id &&
              component.name === "QUESO FRITO"
          )
        )
        .every((row) => row.status === "in_review")
    ).toBe(true);
    expect(
      store.recipes.find((row) => row.name === "DEDOS DE QUESO")
        ?.workbook_cost_match
    ).not.toBe("match");
  });

  it("saves an assumed yield in review on an existing imported component without a recipe", async () => {
    const store = emptyStore();
    store.components.push({
      id: "comp-queso",
      name: "QUESO FRITO",
      output_unit: "unit",
      source_type: "import",
      source_id: "older-batch",
    });
    store.companyByEntityId["comp-queso"] = COMPANY;
    store.posItemNames = ["DEDOS DE QUESO"];
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildAssumedYieldWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(result.sub_recipes_created).toBe(0);
    expect(
      store.componentRecipes.some((row) => row.component_id === "comp-queso")
    ).toBe(true);
    const versions = store.componentRecipeVersions.filter(
      (row) => row.component_id === "comp-queso"
    );
    expect(versions).toHaveLength(1);
    expect(versions[0]?.status).toBe("in_review");
    expect(
      result.review_items.some((item) =>
        item.reason.includes(YIELD_ASSUMED_REASON)
      )
    ).toBe(true);
  });

  it("keeps the working yield when a later import only has an assumed yield", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildConfirmedDemiglassWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(first.sub_recipes_created).toBe(1);
    const component = store.components.find((row) => row.name === "DEMIGLASS");
    expect(component).toBeTruthy();
    const working = store.componentRecipes.find(
      (row) => row.component_id === component?.id
    );
    expect(working?.output_quantity).toBeCloseTo(8, 5);
    expect(working?.output_unit).toBe("lb");
    const workingInputs = store.componentRecipeInputs.filter(
      (row) => row.component_recipe_id === working?.id
    );
    expect(workingInputs).toHaveLength(1);
    expect(workingInputs[0]?.quantity).toBeCloseTo(4, 5);
    expect(normalizeUnit(workingInputs[0]?.unit ?? "")).toBe("lb");

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildAssumedDemiglassWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(second.sub_recipes_created).toBe(0);
    expect(
      second.review_items.some((item) =>
        item.reason.includes(YIELD_ASSUMED_REASON)
      )
    ).toBe(true);

    const stillWorking = store.componentRecipes.find(
      (row) => row.component_id === component?.id
    );
    expect(stillWorking?.output_quantity).toBeCloseTo(8, 5);
    expect(stillWorking?.output_unit).toBe("lb");
    const stillInputs = store.componentRecipeInputs.filter(
      (row) => row.component_recipe_id === stillWorking?.id
    );
    expect(stillInputs).toHaveLength(1);
    expect(stillInputs[0]?.quantity).toBeCloseTo(4, 5);
    expect(normalizeUnit(stillInputs[0]?.unit ?? "")).toBe("lb");

    const versions = store.componentRecipeVersions
      .filter((row) => row.component_id === component?.id)
      .sort((a, b) => a.version_number - b.version_number);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    const approved = versions.filter((row) => row.status === "approved");
    expect(approved[0]?.output_quantity).toBeCloseTo(8, 5);
    expect(approved[0]?.output_unit).toBe("lb");
    const review = versions[versions.length - 1];
    expect(review?.status).toBe("in_review");
    expect(review?.output_quantity).toBeCloseTo(1, 5);
    expect(review?.output_unit).toBe("unit");
    expect(review?.inputs).toHaveLength(1);
    expect(review?.inputs[0]?.quantity).toBeCloseTo(8, 5);
    expect(normalizeUnit(review?.inputs[0]?.unit ?? "")).toBe("lb");
  });

  it("sends a plain ingredient with ORDEN and a price-list CONVOY to needs-a-look", async () => {
    const store = emptyStore();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["ITEM", "UNIDAD", "LIBRA", "ONZA", "PRECIO UNITARIO"],
        ["Sal convoy", "CONVOY", "", "", 1.2],
        ["Tomate", "", 1.2, 0.075, ""],
      ]),
      "Lista de precios"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Nombre", "Unidad", "Costo", "Cantidad", "Total"],
        ["Sal", "ORDEN", 0.15, 1, 0.15],
      ]),
      "Carnes"
    );
    const repo = createMemoryCostWorkbookRepo(store);
    const ai: WorkbookAi = {
      classifyTab: async (input) => {
        if (input.headers.includes("ITEM")) {
          return { type: "price_list", confidence: 0.96 };
        }
        return { type: "category_cost", confidence: 0.93 };
      },
      mapColumns: async (input): Promise<ColumnMapping> => {
        if (input.tabType === "price_list") {
          return {
            ingredient_name: { column: "ITEM", confidence: 0.93 },
            unit: { column: "UNIDAD", confidence: 0.9 },
            price_per_lb: { column: "LIBRA", confidence: 0.93 },
            price_per_oz: { column: "ONZA", confidence: 0.93 },
            price_per_unit: { column: "PRECIO UNITARIO", confidence: 0.8 },
          };
        }
        return {
          ingredient_name: { column: "Nombre", confidence: 0.9 },
          unit: { column: "Unidad", confidence: 0.9 },
          unit_price: { column: "Costo", confidence: 0.9 },
          quantity: { column: "Cantidad", confidence: 0.9 },
          total_cost: { column: "Total", confidence: 0.9 },
        };
      },
      proposeRecipe: async () => "sin sugerencia",
    };
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      ),
      currency: "USD",
      repo,
      ai,
    });
    expect(
      result.review_items.some(
        (item) => item.reason === unknownUnitReason("en", "ORDEN")
      )
    ).toBe(true);
    expect(
      result.review_items.some(
        (item) => item.reason === unknownUnitReason("en", "CONVOY")
      )
    ).toBe(true);
    expect(store.ingredients.some((row) => row.name === "Sal")).toBe(false);
    expect(store.costEntries).toHaveLength(1);
  });

  it("does not start a new recipe from a stray single-cell row and logs empty names", () => {
    const aoa = [
      ["COSTO RESTAURANTE"],
      ["QUESO FRITO"],
      [
        "Articulo",
        "Unidad Detalle",
        "Cantidad",
        "Costo Unitario",
        "Total Costo",
      ],
      ["QUESO GRATINADO", "ONZA", 1, 0.14, 0.14],
      ["SAL"],
      ["HARINA", "GRAMO", 5, 0.001, 0.005],
      ["COSTO TOTAL", "", "", "", 0.145],
      ["COSTO RESTAURANTE"],
      ["NOMBRE VACIO"],
      [
        "Articulo",
        "Unidad Detalle",
        "Cantidad",
        "Costo Unitario",
        "Total Costo",
      ],
      ["COSTO TOTAL", "", "", "", 0],
    ];
    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      aoa,
      lang: "es",
    });
    expect(parsed.groups.map((group) => group.name)).toEqual(["QUESO FRITO"]);
    expect(parsed.groups[0]?.lines.map((line) => line.ingredient_name)).toEqual(
      ["QUESO GRATINADO", "HARINA"]
    );
    expect(parsed.groups.some((group) => group.name === "SAL")).toBe(false);
    expect(
      parsed.skipped.some((item) => item.reason === emptyRecipeNameReason("es"))
    ).toBe(true);
  });

  it("translates remaining review reasons with t()", () => {
    expect(unknownUnitReason("es", "ORDEN")).toBe("unidad desconocida (ORDEN)");
    expect(unknownIngredientReason("es", "Sal")).toBe(
      "ingrediente desconocido (Sal)"
    );
    expect(unknownUnitReason("en", "CONVOY")).toBe("unknown unit (CONVOY)");
    expect(resolveUnitCell("ORDEN", "es")).toEqual({
      ok: false,
      reason: "unidad desconocida (ORDEN)",
    });
    expect(resolveUnitCell("", "es")).toEqual({
      ok: false,
      reason: "Falta la unidad",
    });
  });

  it("restores an imported sub-recipe yield when the later batch is undone", async () => {
    const salsaSheet = (pricePerLb: number) => [
      ["RESTAURANTE LOS RANCHOS"],
      ["COSTO RESTAURANTE"],
      ["SALSA TARTARA"],
      [
        "Articulo",
        "Unidad Detalle",
        "Cantidad",
        "Costo Unitario",
        "Total Costo",
      ],
      ["MAYONESA", "LIBRA", 7.7, 0.98, 7.55],
      ["COSTO TOTAL", "", "", "", 7.55],
      ["PRECIO POR LIBRA", "", "", "", pricePerLb],
    ];
    const workbook = (pricePerLb: number) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([
          ["ITEM", "LIBRA", "ONZA", "PRECIO UNITARIO"],
          ["MAYONESA", 0.98, 0.061, ""],
        ]),
        "Lista de precios"
      );
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(salsaSheet(pricePerLb)),
        "SUB RECETAS 2"
      );
      return Buffer.from(
        XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as ArrayBuffer
      );
    };
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: workbook(0.555),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
    });
    const recipe = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id &&
          component.name === "SALSA TARTARA"
      )
    );
    expect(recipe?.output_quantity).toBeCloseTo(7.55 / 0.555, 5);
    expect(recipe?.output_unit).toBe("lb");

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: workbook(1.51),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
    });
    expect(
      store.componentRecipes.find((row) => row.id === recipe?.id)
        ?.output_quantity
    ).toBeCloseTo(7.55 / 1.51, 5);

    const undone = await undoCostImportBatch(repo, COMPANY, second.batch_id);
    expect(undone.ok).toBe(true);
    expect(
      store.componentRecipes.find((row) => row.id === recipe?.id)
        ?.output_quantity
    ).toBeCloseTo(7.55 / 0.555, 5);
    expect(first.sub_recipes_created).toBe(1);
  });

  it("reads footer typos as yield, never as ingredient lines", () => {
    expect(foldFooterLabel("PRECIOPOR ONZA")).toBe("precio por onza");
    expect(foldFooterLabel("PRECIO POR UNDIAD")).toBe("precio por unidad");
    expect(foldFooterLabel("PRECIO COSTO TORTA")).toBe("precio costo torta");
    const sheets = readWorkbookSheets(buildWorkbookMatchFooterWorkbook());
    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      aoa: sheets.find((sheet) => sheet.name === "SUB RECETAS")?.aoa ?? [],
      lang: "es",
    });
    expect(
      parsed.review.some((item) =>
        /Falta la unidad \(PRECIO|unidad desconocida \(PRECIO/i.test(
          item.reason
        )
      )
    ).toBe(false);
    const queso = parsed.groups.find((group) => group.name === "QUESO FRITO");
    expect(queso?.output_quantity).toBeCloseTo(1, 5);
    expect(queso?.output_unit).toBe("unit");
    expect(queso?.price_per_unit).toBeCloseTo(0.15, 5);
    const salsa = parsed.groups.find((group) => group.name === "SALSA CASA");
    expect(salsa?.output_unit).toBe("lb");
    expect(salsa?.output_quantity).toBeCloseTo(2, 5);
    expect(
      parsed.groups.find((group) => group.name === "TORTA FRITA")?.output_unit
    ).toBe("unit");
  });

  it("matches Excel totals, skips a name-clash self-ref, and flags a mismatch", async () => {
    const store = emptyStore();
    store.posItemNames = ["DEDOS DE QUESO", "TOSTONES", "PLATO MALO"];
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });

    expect(result.recipe_match?.dishes_total).toBeGreaterThanOrEqual(2);
    expect(result.recipe_match?.headline).toMatch(
      /platillos cuadran con el Excel/
    );
    const malo = result.recipe_match?.mismatches.find(
      (row) => row.name === "PLATO MALO"
    );
    expect(malo).toBeTruthy();
    expect(malo?.excel_cost).toBeCloseTo(9.99, 2);
    expect(malo?.milton_cost ?? 0).toBeLessThan(2);
    expect(
      result.review_items.some((item) =>
        item.reason.includes("referencia a sí misma")
      )
    ).toBe(true);
    expect(
      store.recipeInputs.some((row) => {
        const recipe = store.recipes.find((r) => r.id === row.recipe_id);
        const menu = store.menuItems.find((m) => m.id === recipe?.menu_item_id);
        return (
          menu?.name === "TOSTONES" &&
          row.input_type === "component" &&
          store.components.some(
            (component) =>
              component.id === row.component_id && component.name === "TOSTONES"
          )
        );
      })
    ).toBe(false);
    expect(
      store.recipes.some((row) => {
        const menu = store.menuItems.find((m) => m.id === row.menu_item_id);
        return menu?.name === "TOSTONES";
      })
    ).toBe(false);

    const dedos = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    expect(dedos?.workbook_cost_match).toBe("match");
    expect(dedos?.workbook_variance_amount).toBeCloseTo(0, 2);
    expect(dedos?.workbook_variance_pct).toBeCloseTo(0, 2);
    const maloRecipe = store.recipes.find((row) => row.name === "PLATO MALO");
    expect(maloRecipe?.workbook_cost_match).toBe("mismatch");
    expect(maloRecipe?.workbook_variance_amount).not.toBeNull();
    expect(maloRecipe?.workbook_variance_pct).not.toBeNull();

    const costing = costingDataFromStore(store);
    const maloMenu = store.menuItems.find((row) => row.name === "PLATO MALO");
    const live = calculateMenuItemCost(maloMenu!.id, {
      ...costing,
      menuRecipesByMenuItemId: new Map(
        [...costing.menuRecipesByMenuItemId.entries()].map(([id, recipe]) => [
          id,
          {
            ...recipe,
            workbook_cost_match:
              id === maloMenu?.id ? "mismatch" : recipe.workbook_cost_match,
          },
        ])
      ),
    });
    expect(live.status).toBe("workbook_mismatch");
    expect(live.cost).toBeNull();
  });

  it("protects a hand-edited imported recipe from the next workbook upload", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(first.recipes_created).toBeGreaterThan(0);
    const recipe = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    expect(recipe?.source_type).toBe("import");
    await repo.markRecipeManual(COMPANY, recipe!.id);
    const input = store.recipeInputs.find(
      (row) => row.recipe_id === recipe?.id
    );
    expect(input).toBeTruthy();
    input!.quantity = 99;

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(
      second.skipped_reasons.some(
        (row) => row.reason === handmadeRecipeExistsReason("es")
      )
    ).toBe(true);
    expect(
      store.recipeInputs.find((row) => row.id === input?.id)?.quantity
    ).toBe(99);
    expect(
      store.recipes.find((row) => row.id === recipe?.id)?.source_type
    ).toBe("manual");
  });

  it("protects a hand-edited imported prepared item from the next workbook upload", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(first.sub_recipes_created).toBeGreaterThan(0);
    const component = store.components.find(
      (row) => row.name === "QUESO FRITO"
    );
    expect(component?.source_type).toBe("import");
    const componentRecipe = store.componentRecipes.find(
      (row) => row.component_id === component?.id
    );
    expect(componentRecipe).toBeTruthy();
    await repo.markComponentManual(COMPANY, component!.id, componentRecipe!.id);
    const input = store.componentRecipeInputs.find(
      (row) => row.component_recipe_id === componentRecipe?.id
    );
    expect(input).toBeTruthy();
    input!.quantity = 99;

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(
      second.skipped_reasons.some(
        (row) => row.reason === handmadeRecipeExistsReason("es")
      )
    ).toBe(true);
    expect(
      store.componentRecipeInputs.find((row) => row.id === input?.id)?.quantity
    ).toBe(99);
    expect(
      store.components.find((row) => row.id === component?.id)?.source_type
    ).toBe("manual");
  });

  it("clears the Excel check on a hand save so a mismatch starts counting", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    const malo = store.recipes.find((row) => row.name === "PLATO MALO");
    const maloMenu = store.menuItems.find((row) => row.name === "PLATO MALO");
    expect(malo?.workbook_cost_match).toBe("mismatch");
    expect(
      calculateMenuItemCost(maloMenu!.id, costingDataFromStore(store)).status
    ).toBe("workbook_mismatch");

    await repo.markRecipeManual(COMPANY, malo!.id);
    const after = store.recipes.find((row) => row.id === malo?.id);
    expect(after?.source_type).toBe("manual");
    expect(after?.workbook_cost_match).toBeNull();
    expect(after?.workbook_computed_cost).toBeNull();
    const live = calculateMenuItemCost(
      maloMenu!.id,
      costingDataFromStore(store)
    );
    expect(live.status).toBe("complete");
    expect(live.cost).toBeGreaterThan(0);
  });

  it("does not keep counting a stale Excel match after a hand edit", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    const dedos = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    const dedosMenu = store.menuItems.find(
      (row) => row.name === "DEDOS DE QUESO"
    );
    expect(dedos?.workbook_cost_match).toBe("match");
    const input = store.recipeInputs.find((row) => row.recipe_id === dedos?.id);
    expect(input).toBeTruthy();
    input!.quantity = 4;

    await repo.markRecipeManual(COMPANY, dedos!.id);
    const after = store.recipes.find((row) => row.id === dedos?.id);
    expect(after?.workbook_cost_match).toBeNull();
    expect(after?.source_type).toBe("manual");
    const live = calculateMenuItemCost(
      dedosMenu!.id,
      costingDataFromStore(store)
    );
    expect(live.status).toBe("complete");
    expect(live.cost).not.toBeCloseTo(dedos?.workbook_cost_total ?? 0.15, 2);
    expect(after?.workbook_cost_match).not.toBe("match");
  });

  it("fails fast before writing when migration 035 columns are missing", async () => {
    const store = emptyStore();
    store.workbookCostColumns = false;
    const repo = createMemoryCostWorkbookRepo(store);
    await expect(
      importCostWorkbook({
        companyId: COMPANY,
        filename: FILENAME,
        buffer: buildWorkbookMatchFooterWorkbook(),
        currency: "USD",
        repo,
        ai: aiSharedArticuloAsRecipeAndIngredient(),
        lang: "es",
      })
    ).rejects.toSatisfy((err) => {
      expect(isMissingWorkbookCostColumnsError(err)).toBe(true);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(MISSING_WORKBOOK_COST_MIGRATION_ES);
      return true;
    });
    expect(store.batches).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
    expect(store.ingredients).toHaveLength(0);
    expect(store.reviewItems).toHaveLength(0);
  });

  it("fails fast before writing when migration 036 columns are missing", async () => {
    const store = emptyStore();
    store.importCosting036Columns = false;
    const repo = createMemoryCostWorkbookRepo(store);
    await expect(
      importCostWorkbook({
        companyId: COMPANY,
        filename: FILENAME,
        buffer: buildWorkbookMatchFooterWorkbook(),
        currency: "USD",
        repo,
        ai: aiSharedArticuloAsRecipeAndIngredient(),
        lang: "es",
      })
    ).rejects.toSatisfy((err) => {
      expect(isMissingImportCosting036Error(err)).toBe(true);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(MISSING_IMPORT_COSTING_036_ES);
      return true;
    });
    expect(store.batches).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
    expect(store.ingredients).toHaveLength(0);
  });

  it("skips hand-edited recipes when reconciling Excel totals", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    const recipe = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    expect(recipe?.workbook_cost_match).toBe("match");
    await repo.markRecipeManual(COMPANY, recipe!.id);
    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(
      store.recipes.find((row) => row.id === recipe?.id)?.workbook_cost_match
    ).toBeNull();
    expect(
      second.recipe_match?.mismatches.some(
        (row) => row.name === "DEDOS DE QUESO"
      )
    ).toBe(false);
  });

  it("undo restores workbook_* and source_type from the previous import", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const first = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(first.recipes_created).toBeGreaterThan(0);
    const recipe = store.recipes.find((row) => row.name === "DEDOS DE QUESO");
    expect(recipe?.source_type).toBe("import");
    expect(recipe?.workbook_cost_match).toBe("match");
    recipe!.workbook_cost_match = "mismatch";
    recipe!.workbook_variance_amount = 1.25;
    recipe!.workbook_variance_pct = 12.5;

    const second = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildWorkbookMatchFooterWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(second.recipes_created).toBe(0);
    expect(
      store.recipes.find((row) => row.id === recipe?.id)?.workbook_cost_match
    ).toBe("match");
    expect(
      store.recipes.find((row) => row.id === recipe?.id)
        ?.workbook_variance_amount
    ).toBeCloseTo(0, 2);

    const undone = await undoCostImportBatch(repo, COMPANY, second.batch_id);
    expect(undone.ok).toBe(true);
    const restored = store.recipes.find((row) => row.id === recipe?.id);
    expect(restored?.source_type).toBe("import");
    expect(restored?.workbook_cost_match).toBe("mismatch");
    expect(restored?.workbook_variance_amount).toBeCloseTo(1.25, 2);
    expect(restored?.workbook_variance_pct).toBeCloseTo(12.5, 2);
  });

  it("period costing picks recipe versions in server code only", () => {
    const pageData = readFileSync(
      "lib/restaurant/cockpit-page-data.ts",
      "utf8"
    );
    expect(pageData).toContain("itemCostLookupForPeriod");
    expect(pageData).toContain("asOfDate");
    const cockpit = readFileSync(
      "components/restaurant/ProfitabilityCockpit.tsx",
      "utf8"
    );
    expect(cockpit).not.toMatch(/asOfDate/);
    expect(cockpit).not.toMatch(/pickApprovedVersion/);
    const table = readFileSync(
      "components/restaurant/cockpit/MenuProfitabilityTable.tsx",
      "utf8"
    );
    expect(table).not.toMatch(/asOfDate/);
    expect(table).not.toMatch(/pickApprovedVersion/);
  });

  it("computes 1 ORDEN as the sub-recipe batch so the dish matches Excel", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildOrdenPortionCostWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    const papas = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "PAPAS FRITAS"
      )
    );
    expect(papas?.output_quantity).toBeCloseTo(3, 5);
    expect(papas?.output_unit).toBe("lb");
    const bistecInput = store.recipeInputs.find((row) => {
      const recipe = store.recipes.find((item) => item.id === row.recipe_id);
      return recipe?.name === "BISTEC" && row.input_type === "component";
    });
    expect(bistecInput?.quantity).toBeCloseTo(3, 5);
    expect(bistecInput?.unit).toBe("lb");

    const bistecMenu = store.menuItems.find((row) => row.name === "BISTEC");
    const live = calculateMenuItemCost(
      bistecMenu!.id,
      costingDataFromStore(store)
    );
    expect(live.status).toBe("complete");
    expect(live.cost).toBeCloseTo(6.2, 2);
    expect(
      store.recipes.find((row) => row.name === "BISTEC")?.workbook_cost_match
    ).toBe("match");

    const barato = result.recipe_match?.mismatches.find(
      (row) => row.name === "BISTEC BARATO"
    );
    expect(barato).toBeTruthy();
    expect(barato?.excel_cost).toBeCloseTo(5.4, 2);
    expect(barato?.milton_cost).toBeCloseTo(6.2, 2);
    expect(
      store.recipes.find((row) => row.name === "BISTEC BARATO")
        ?.workbook_cost_match
    ).toBe("mismatch");
  });

  it("does not persist a dish that dropped a needs-a-look line as complete", async () => {
    const store = emptyStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildIncompleteDishWorkbook(),
      currency: "USD",
      repo,
      ai: aiSharedArticuloAsRecipeAndIngredient(),
      lang: "es",
    });
    expect(
      result.review_items.some((item) =>
        /unidad desconocida \(BULTAZO\)|unknown unit \(BULTAZO\)/i.test(
          item.reason
        )
      )
    ).toBe(true);
    expect(store.recipes.some((row) => row.name === "POLLO EMPANIZADO")).toBe(
      false
    );
    const menu = store.menuItems.find((row) => row.name === "POLLO EMPANIZADO");
    expect(menu).toBeUndefined();
    expect(
      store.recipeInputs.some((row) => row.unit === "ONZA" || row.unit === "oz")
    ).toBe(false);
  });

  it("overrides a same-name ingredient stub qty 0 / unit '' via withQty", () => {
    const resolved = resolveCatalogInput(
      "POLLO",
      [{ id: "ing-pollo", name: "POLLO" }],
      [],
      new Map(),
      "es",
      "POLLO"
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.input.input_type).toBe("ingredient");
    expect(resolved.input.quantity).toBe(0);
    expect(resolved.input.unit).toBe("");
    const applied = withQty(resolved.input, {
      tabName: "DE LA PARRILLA",
      rowIndex: 1,
      recipeName: "POLLO",
      ingredient_name: "POLLO",
      quantity: 4,
      unit: "ONZA",
      raw: {},
    });
    expect(applied.quantity).toBe(4);
    expect(applied.unit).toBe("ONZA");
    expect(applied.ingredient_id).toBe("ing-pollo");
  });

  it("overrides a catalog stub qty 0 / unit '' for a component too", () => {
    const resolved = resolveCatalogInput(
      "GUARNICION 1",
      [],
      [{ id: "comp-1", name: "GUARNICION 1" }],
      new Map(),
      "es"
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.input.input_type).toBe("component");
    expect(resolved.input.quantity).toBe(0);
    expect(resolved.input.unit).toBe("");
    const applied = withQty(resolved.input, {
      tabName: "DE LA PARRILLA",
      rowIndex: 1,
      recipeName: "PUYASO",
      ingredient_name: "GUARNICION 1",
      quantity: 2,
      unit: "portion",
      raw: {},
    });
    expect(applied.quantity).toBe(2);
    expect(applied.unit).toBe("portion");
    expect(applied.component_id).toBe("comp-1");
  });

  it("reconciles workbook totals to the selected restaurant, not another location", () => {
    const items = [
      { id: "m-a", name: "BISTEC", location_id: "loc-a" },
      { id: "m-b", name: "BISTEC", location_id: "loc-b" },
      { id: "m-loose", name: "BISTEC", location_id: null },
    ];
    expect(pickMenuItemForLocation(items, "BISTEC", "loc-b")?.id).toBe("m-b");
    expect(pickMenuItemForLocation(items, "BISTEC", "loc-a")?.id).toBe("m-a");
    expect(pickMenuItemForLocation(items, "BISTEC", "loc-missing")?.id).toBe(
      "m-loose"
    );
  });
});

function contentOnlyWorkbookAi(): WorkbookAi {
  return {
    proposeRecipe: async () => "sin sugerencia",
    classifyTab: async (input) => {
      const name = input.sheetName.toLowerCase();
      if (name.includes("bodega") || input.headers.includes("ITEM")) {
        return { type: "price_list" as const, confidence: 0.96 };
      }
      if (name.includes("sub receta")) {
        return {
          type: "sub_recipe" as const,
          confidence: 0.9,
          notes:
            "The dataset is classified as sub_recipe due to the presence of a tab named SUB RECETAS",
        };
      }
      return { type: "ignore" as const, confidence: 0.4 };
    },
    mapColumns: async () => ({}),
  };
}

describe("real Los Ranchos filled-down block layout", () => {
  it("shifts a filled-down name so Articulo is not read as the unit", () => {
    const aligned = alignFilledDownBlockRow(
      ["QUESO FRITO", "QUESO CREMADO", "ONZA", 1.14, 0.1475, 0.16815],
      { ingredient: 0, unit: 1, qty: 2, unitCost: 3, total: 4 },
      "QUESO FRITO"
    );
    expect(aligned.name).toBe("QUESO CREMADO");
    expect(aligned.unitRaw).toBe("ONZA");
    expect(aligned.qty).toBeCloseTo(1.14, 5);
  });

  it("parses filled-down blocks with real sheet row numbers and DEMIGLASS yield", () => {
    const sheets = readWorkbookSheets(
      buildRealLayoutCostoRestauranteWorkbook()
    );
    const sub = sheets.find((sheet) => sheet.name === "SUB RECETAS");
    expect(sheetLooksLikeCostoRestauranteBlocks(sub?.aoa ?? [])).toBe(true);
    const parsed = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      aoa: sub?.aoa ?? [],
      lang: "es",
    });
    const queso = parsed.groups.find((group) => group.name === "QUESO FRITO");
    expect(queso?.yield_assumed).toBe(true);
    expect(queso?.lines.map((line) => line.ingredient_name)).toEqual(
      expect.arrayContaining(["QUESO CREMADO", "HARINA", "ACEITE"])
    );
    expect(queso?.start_row_index).toBeGreaterThan(0);
    expect(
      parsed.review.some(
        (item) =>
          (item.reason.includes(YIELD_ASSUMED_REASON) ||
            item.reason === inferredCostTotalReason("es", "QUESO FRITO")) &&
          item.reason.includes("QUESO FRITO") &&
          item.rowIndex === queso?.start_row_index
      )
    ).toBe(true);

    const demi = parsed.groups.find((group) => group.name === "DEMIGLASS");
    expect(demi?.output_unit).toBe("lb");
    expect(demi?.output_quantity).toBeCloseTo(8, 5);
    expect(demi?.price_per_lb).toBeCloseTo(0.25, 5);
    expect(demi?.cost_total == null || demi?.cost_total === 0).toBe(true);
    expect(demi?.inferred_cost_total).toBeCloseTo(2, 5);
    expect(demi?.cost_total_inferred).toBe(true);
    expect(demi?.yield_assumed).toBe(true);
    expect(demi?.start_row_index).toBeGreaterThan(20);
    expect(
      parsed.review.some(
        (item) =>
          item.reason === inferredCostTotalReason("es", "DEMIGLASS") &&
          item.rowIndex === demi?.start_row_index
      )
    ).toBe(true);
    expect(
      parsed.review.some(
        (item) =>
          /no pude calcular el rendimiento/.test(item.reason) &&
          item.reason.includes("DEMIGLASS")
      )
    ).toBe(false);
    expect(
      parsed.review.some(
        (item) =>
          item.reason.includes("APIO") &&
          item.rowIndex > 20 &&
          item.rowIndex !== 0
      )
    ).toBe(true);
  });

  it("imports through content-based mapping and persist with non-zero counts", async () => {
    const store = emptyStore();
    store.posItemNames = ["DEDOS DE QUESO"];
    seedCatalogFromWorkbook(store, buildRealLayoutCostoRestauranteWorkbook());
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildRealLayoutCostoRestauranteWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      ai: contentOnlyWorkbookAi(),
      locationId: "loc-ranchos",
      lang: "es",
    });

    const subTab = result.tabs.find((tab) => tab.name === "SUB RECETAS");
    expect(subTab?.type).toBe("sub_recipe");
    expect(subTab?.mapping_source).toBe("heuristic");
    expect(mappingSourceLabel("es", subTab?.mapping_source ?? "")).toBe(
      "columnas según los valores"
    );
    expect(
      result.tabs.find((tab) => tab.name === "ENTRADAS INDIVIDUALES")?.type
    ).toBe("recipe");
    expect(
      result.tabs.find((tab) => tab.name === "COSTOS RESTAURANTE 2026")?.type
    ).toBe("ignore");

    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(2);
    expect(result.recipes_created).toBeGreaterThanOrEqual(1);
    expect(result.menu_items_created).toBeGreaterThanOrEqual(1);
    expect(store.components.map((row) => row.name)).toEqual(
      expect.arrayContaining(["QUESO FRITO", "DEMIGLASS"])
    );
    expect(store.components.map((row) => row.name)).not.toContain(
      "ROLL VEGETALES"
    );
    expect(store.ingredients.map((row) => row.name)).toEqual(
      expect.arrayContaining(["QUESO CREMADO"])
    );

    const queso = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "QUESO FRITO"
      )
    );
    expect(queso?.output_quantity).toBeCloseTo(1, 5);
    expect(
      store.componentRecipeVersions
        .filter((row) => row.component_id === queso?.component_id)
        .every((row) => row.status === "in_review")
    ).toBe(true);

    const demi = store.componentRecipes.find((row) =>
      store.components.some(
        (component) =>
          component.id === row.component_id && component.name === "DEMIGLASS"
      )
    );
    expect(demi?.output_quantity).toBeCloseTo(8, 5);
    expect(demi?.output_unit).toBe("lb");

    expect(store.menuItems.map((row) => row.name)).toContain("DEDOS DE QUESO");
    const assumed = result.review_items.find(
      (item) =>
        item.reason.includes(YIELD_ASSUMED_REASON) ||
        item.reason.includes("sumé los totales")
    );
    expect(assumed?.row_index).toBeGreaterThan(0);
    expect(
      result.review_items.some(
        (item) => item.tab_name === "SUB RECETAS" && item.row_index === 0
      )
    ).toBe(false);
  });

  it("surfaces a Spanish error when a recipe write fails instead of a silent 0", async () => {
    const store = emptyStore();
    seedCatalogFromWorkbook(store, buildRealLayoutCostoRestauranteWorkbook());
    store.failNextComponentCreate =
      "duplicate key value violates unique constraint";
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildRealLayoutCostoRestauranteWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      ai: contentOnlyWorkbookAi(),
      lang: "es",
    });
    expect(
      result.review_items.some((item) =>
        item.reason.includes(
          persistWriteFailedReason(
            "es",
            "duplicate key value violates unique constraint",
            "QUESO FRITO"
          )
        )
      )
    ).toBe(true);
    expect(result.sub_recipes_created).toBeGreaterThanOrEqual(1);
    expect(store.components.map((row) => row.name)).toContain("DEMIGLASS");
  });
});

describe("cost workbook review-blocker follow-ups", () => {
  it("parses Latin-American comma decimals and sends ambiguous values to review", () => {
    expect(parseCostImportNumber("$ 0,18")).toBeCloseTo(0.18, 5);
    expect(parseCostImportNumber("$ 0,14750")).toBeCloseTo(0.1475, 5);
    expect(parseCostImportNumber("2,5")).toBeCloseTo(2.5, 5);
    expect(parseCostImportNumber("1,14")).toBeCloseTo(1.14, 5);
    expect(parseCostImportNumber("$ 6,24")).toBeCloseTo(6.24, 5);
    expect(parseCostImportNumber("1,234.56")).toBeCloseTo(1234.56, 5);
    expect(parseCostImportNumber("1.234,56")).toBeCloseTo(1234.56, 5);
    expect(parseCostImportNumber(0.18)).toBeCloseTo(0.18, 5);
    expect(inspectCostImportNumber("1,234")).toEqual({
      kind: "ambiguous",
      raw: "1,234",
    });
    expect(inspectCostImportNumber("4,405,286")).toEqual({
      kind: "ambiguous",
      raw: "4,405,286",
    });
    expect(parseCostImportNumber("1,234")).toBeNull();
    expect(ambiguousNumberReason("es", "1,234")).toBe(
      "este número es ambiguo (1,234)"
    );
  });

  it("resolves ORDEN on a filled-down empty-column-A layout without making it global", () => {
    const sheets = readWorkbookSheets(buildLeadingEmptyOrdenCommaWorkbook());
    const known = collectCostoRestauranteBlockNames(
      sheets.find((sheet) => sheet.name === "SUB RECETAS")?.aoa ?? []
    );
    expect(known).toEqual(
      expect.arrayContaining(["GUARNICION 1", "DEMIGLASS", "DEDOS DE QUESO"])
    );
    const parsed = collectCostoRestauranteBlocks({
      tabName: "DE LA PARRILLA",
      tabKind: "recipe",
      aoa: sheets.find((sheet) => sheet.name === "DE LA PARRILLA")?.aoa ?? [],
      knownSubRecipeNames: known,
      lang: "es",
    });
    const puyaso = parsed.groups.find((group) => group.name === "PUYASO");
    expect(
      puyaso?.lines.some(
        (line) =>
          line.ingredient_name === "GUARNICION 1" && line.unit === "portion"
      )
    ).toBe(true);
    expect(
      parsed.review.some((item) =>
        /unidad desconocida \(ORDEN\)/.test(item.reason)
      )
    ).toBe(false);
    expect(
      parsed.review.some(
        (item) => item.reason === ambiguousNumberReason("es", "1,234")
      )
    ).toBe(true);
    expect(resolveUnitCell("ORDEN", "es").ok).toBe(false);

    const sub = collectCostoRestauranteBlocks({
      tabName: "SUB RECETAS",
      tabKind: "sub_recipe",
      aoa: sheets.find((sheet) => sheet.name === "SUB RECETAS")?.aoa ?? [],
      lang: "es",
    });
    const papa = sub.groups
      .find((group) => group.name === "GUARNICION 1")
      ?.lines.find((line) => line.ingredient_name === "PAPA");
    expect(papa?.quantity).toBeCloseTo(0.5, 5);
    const crema = sub.groups
      .find((group) => group.name === "DEDOS DE QUESO")
      ?.lines.find((line) => line.ingredient_name === "QUESO CREMADO");
    expect(crema?.quantity).toBeCloseTo(1.14, 5);
    const demi = sub.groups.find((group) => group.name === "DEMIGLASS");
    expect(demi?.cost_total == null || demi?.cost_total === 0).toBe(true);
    expect(demi?.inferred_cost_total).toBeCloseTo(2, 5);
    expect(demi?.cost_total_inferred).toBe(true);
    expect(demi?.yield_assumed).toBe(true);
    expect(demi?.output_quantity).toBeCloseTo(8, 5);
  });

  it("does not auto-link or create a near-match typo ingredient", () => {
    const resolved = resolveCatalogInput(
      "EMPANIZAOR",
      [{ id: "ing-emp", name: "EMPANIZADOR" }],
      [],
      new Map(),
      "es"
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toBe(
      unsureIngredientNameReason("es", "EMPANIZAOR", "EMPANIZADOR")
    );
  });

  function seedCatalog(store: MemoryCostWorkbookStore) {
    store.ingredients.push(
      {
        id: "ing-emp",
        name: "EMPANIZADOR",
        default_unit: "oz",
        current_unit_cost: 0.09,
        currency: "USD",
      },
      {
        id: "ing-puyaso",
        name: "PUYASO",
        default_unit: "oz",
        current_unit_cost: 0.58,
        currency: "USD",
      }
    );
  }

  it("never creates an ingredient from a recipe-line name, whatever the old toggle was", async () => {
    const on = emptyStore();
    seedCatalog(on);
    const onResult = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLeadingEmptyOrdenCommaWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(on),
      ai: contentOnlyWorkbookAi(),
      lang: "es",
    });
    expect(on.ingredients.map((row) => row.name).sort()).toEqual([
      "EMPANIZADOR",
      "PUYASO",
    ]);
    expect(on.ingredients.map((row) => row.name)).not.toContain(
      "QUESO CREMADO"
    );
    expect(
      onResult.review_items.some((item) =>
        item.reason.includes(unknownIngredientReason("es", "QUESO CREMADO"))
      )
    ).toBe(true);
    expect(on.ingredients.map((row) => row.name)).not.toContain("EMPANIZAOR");
    expect(
      onResult.review_items.some(
        (item) =>
          item.reason ===
          unsureIngredientNameReason("es", "EMPANIZAOR", "EMPANIZADOR")
      )
    ).toBe(true);
  });

  it("keeps an assumed yield in review when the catalog is already loaded", async () => {
    const on = emptyStore();
    seedCatalog(on);
    seedCatalogFromWorkbook(on, buildLeadingEmptyOrdenCommaWorkbook(), [
      "EMPANIZAOR",
    ]);
    const onResult = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLeadingEmptyOrdenCommaWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(on),
      ai: contentOnlyWorkbookAi(),
      lang: "es",
    });
    expect(on.menuItems.map((row) => row.name)).toContain("PUYASO");
    expect(
      onResult.review_items.some((item) =>
        /unidad desconocida \(ORDEN\)/.test(item.reason)
      )
    ).toBe(false);
    const demi = on.componentRecipes.find((row) =>
      on.components.some(
        (component) =>
          component.id === row.component_id && component.name === "DEMIGLASS"
      )
    );
    expect(demi?.workbook_cost_total == null).toBe(true);
    expect(demi?.workbook_cost_match == null).toBe(true);
    expect(
      on.componentRecipeVersions
        .filter((row) => row.component_id === demi?.component_id)
        .every((row) => row.status === "in_review")
    ).toBe(true);
    expect(
      onResult.recipe_match?.mismatches.some((row) => row.name === "DEMIGLASS")
    ).toBe(false);
  });

  it("keeps a created dish in undo when its recipe write fails", async () => {
    const store = emptyStore();
    seedCatalog(store);
    seedCatalogFromWorkbook(store, buildLeadingEmptyOrdenCommaWorkbook());
    store.failNextRecipeCreate = "recipes_pkey";
    const result = await importCostWorkbook({
      companyId: COMPANY,
      filename: FILENAME,
      buffer: buildLeadingEmptyOrdenCommaWorkbook(),
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      ai: contentOnlyWorkbookAi(),
      lang: "es",
    });
    expect(store.menuItems.map((row) => row.name)).toContain("PUYASO");
    expect(store.recipes.some((row) => row.name === "PUYASO")).toBe(false);
    expect(
      result.review_items.some((item) =>
        item.reason.includes(
          dishCreatedRecipeFailedReason("es", "PUYASO", "recipes_pkey")
        )
      )
    ).toBe(true);
    const batch = store.batches[0];
    expect(batch?.undo_snapshot.created_menu_item_ids.length).toBeGreaterThan(
      0
    );
    const undone = await undoCostImportBatch(
      createMemoryCostWorkbookRepo(store),
      COMPANY,
      batch.id
    );
    expect(undone.ok).toBe(true);
    expect(store.menuItems.map((row) => row.name)).not.toContain("PUYASO");
  });

  it("leaves an unknown line pending and creates no ingredient", async () => {
    const store = emptyStore();
    await persistWorkbookRecipes({
      companyId: COMPANY,
      batchId: "batch-null-price",
      currency: "USD",
      repo: createMemoryCostWorkbookRepo(store),
      lang: "es",
      groups: [
        {
          name: "PREP SECA",
          tabName: "SUB RECETAS",
          kind: "sub_recipe",
          block_layout: true,
          output_quantity: 1,
          output_unit: "unit",
          lines: [
            {
              tabName: "SUB RECETAS",
              rowIndex: 1,
              recipeName: "PREP SECA",
              ingredient_name: "HIERBA SECA",
              quantity: 1,
              unit: "ONZA",
              raw: {
                Articulo: "HIERBA SECA",
                "Unidad Detalle": "ONZA",
                Cantidad: 1,
              },
            },
          ],
        },
      ],
    });
    expect(store.ingredients).toHaveLength(0);
    expect(store.ingredients.some((row) => row.name === "HIERBA SECA")).toBe(
      false
    );
  });

  it("keeps the partial undo record when persistWorkbookRecipes throws", () => {
    const changes = {
      ...emptyUndoSnapshot(),
      created_menu_item_ids: ["menu-1"],
      created_ingredient_ids: ["ing-1"],
    };
    const err = new PersistWorkbookRecipesError("boom", {
      changes,
      review: [],
      skipped: [],
    });
    const stats = persistStatsFromError(err);
    expect(stats?.changes.created_menu_item_ids).toEqual(["menu-1"]);
    expect(stats?.changes.created_ingredient_ids).toEqual(["ing-1"]);
    expect(persistStatsFromError(new Error("plain"))).toBeNull();
  });
});
