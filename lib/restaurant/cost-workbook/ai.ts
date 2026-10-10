// Tab type + column mapping. AI proposes meaning; heuristics fill in
// only when the model is missing or returns nothing usable.

import { classifyDataset } from "@/lib/ai/dataset-classifier";
import { suggestColumnMappings } from "@/lib/ai/column-mapper";
import { normalizeHeaderToken } from "./header";
import {
  COST_TAB_TYPES,
  targetFieldsForTab,
  type ColumnMapping,
  type CostTabType,
  type TabClassification,
} from "./types";

export interface ClassifyTabInput {
  sheetName: string;
  headers: string[];
  sampleRows: Record<string, unknown>[];
}

export interface MapColumnsInput {
  tabType: CostTabType;
  headers: string[];
  sampleRows: Record<string, unknown>[];
}

export interface WorkbookAi {
  classifyTab(input: ClassifyTabInput): Promise<TabClassification>;
  mapColumns(input: MapColumnsInput): Promise<ColumnMapping>;
}

const CLASSIFIER_CONTEXT =
  "Restaurant ingredient-cost workbook. Classify this sheet as exactly one of: " +
  "price_list (item + unit prices such as per lb/oz), " +
  "category_cost (food-category sheet with name/unit/cost/quantity/total), " +
  "purchases (one purchase per row with date/supplier/qty/total), " +
  "recipe (ingredient lines for a dish — not costs to import yet), " +
  "ignore (cover, index, empty, or unrelated). " +
  "Set detectedTable to that exact token.";

const TYPE_ALIASES: Record<string, CostTabType> = {
  price_list: "price_list",
  pricelist: "price_list",
  lista_de_precios: "price_list",
  lista_precios: "price_list",
  precios: "price_list",
  recipe: "recipe",
  recipes: "recipe",
  receta: "recipe",
  recetas: "recipe",
  purchases: "purchases",
  purchase: "purchases",
  compras: "purchases",
  compra: "purchases",
  invoice: "purchases",
  invoices: "purchases",
  factura: "purchases",
  facturas: "purchases",
  category_cost: "category_cost",
  category_costs: "category_cost",
  category: "category_cost",
  costos: "category_cost",
  costo: "category_cost",
  ignore: "ignore",
  unknown: "ignore",
  other: "ignore",
  index: "ignore",
  cover: "ignore",
};

/** Exact tokens / aliases only — a string that merely contains "cost" is not a type. */
export function normalizeCostTabType(raw: string): CostTabType | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if ((COST_TAB_TYPES as readonly string[]).includes(key)) {
    return key as CostTabType;
  }
  return TYPE_ALIASES[key] ?? null;
}

function headerSet(headers: string[]): Set<string> {
  return new Set(headers.map((h) => normalizeHeaderToken(h)));
}

function hasAny(set: Set<string>, tokens: string[]): boolean {
  return tokens.some((t) => set.has(t) || [...set].some((h) => h.includes(t)));
}

/**
 * Deterministic guess used when AI is unavailable. Obvious layouts
 * (ITEM/LIBRA/ONZA, Spanish name/unit/cost/qty/total) score high.
 */
export function classifyCostTabHeuristic(
  input: ClassifyTabInput
): TabClassification {
  const set = headerSet(input.headers);
  const nameBlob = normalizeHeaderToken(
    `${input.sheetName} ${input.headers.join(" ")}`
  );

  if (
    hasAny(set, ["item", "nombre", "producto", "ingrediente"]) &&
    hasAny(set, ["libra", "onza", "preciounitario"])
  ) {
    return {
      type: "price_list",
      confidence: 0.94,
      notes: "heuristic price list",
    };
  }

  if (
    (/(receta|recipe|preparacion|preparación)/.test(nameBlob) ||
      hasAny(set, ["receta", "porcion", "porción", "procedimiento"])) &&
    hasAny(set, ["ingrediente", "ingredient", "nombre"]) &&
    !hasAny(set, ["total", "costo", "importe"])
  ) {
    return { type: "recipe", confidence: 0.9, notes: "heuristic recipe" };
  }

  if (
    hasAny(set, ["costdate", "fecha", "invoicedate"]) &&
    hasAny(set, ["supplier", "proveedor", "vendor"]) &&
    hasAny(set, ["ingredient", "ingrediente", "item"])
  ) {
    return {
      type: "purchases",
      confidence: 0.88,
      notes: "heuristic purchases",
    };
  }

  if (
    hasAny(set, ["nombre", "producto", "item", "ingrediente", "ingredient"]) &&
    hasAny(set, ["unidad", "unit", "uom"]) &&
    hasAny(set, ["costo", "precio", "cost", "price"]) &&
    hasAny(set, ["cantidad", "qty", "quantity", "total"])
  ) {
    return {
      type: "category_cost",
      confidence: 0.92,
      notes: "heuristic category cost",
    };
  }

  return { type: "ignore", confidence: 0.35, notes: "heuristic unsure" };
}

const HEURISTIC_COLUMNS: Record<string, string[]> = {
  ingredient_name: [
    "item",
    "nombre",
    "producto",
    "ingrediente",
    "ingredient",
    "articulo",
    "artículo",
  ],
  unit: ["unidad", "unit", "uom", "medida"],
  unit_price: ["costo", "coste", "precio", "price", "cost"],
  quantity: ["cantidad", "qty", "quantity"],
  total_cost: ["total", "importe", "amount", "linetotal"],
  supplier_name: ["proveedor", "supplier", "vendor"],
  cost_date: ["fecha", "date", "costdate", "invoicedate"],
  currency: ["currency", "moneda", "divisa"],
  price_per_lb: ["libra", "lb", "preciolibra"],
  price_per_oz: ["onza", "oz", "precioonza"],
  price_per_unit: ["preciounitario", "unitprice", "precio"],
};

export function mapColumnsHeuristic(input: MapColumnsInput): ColumnMapping {
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  const fields = targetFieldsForTab(input.tabType);
  for (const field of fields) {
    const candidates = HEURISTIC_COLUMNS[field.name] ?? [];
    const hit = input.headers.find((header) => {
      const token = normalizeHeaderToken(header);
      if (used.has(header)) return false;
      return candidates.some((c) => token === c || token.includes(c));
    });
    if (hit) {
      used.add(hit);
      mapping[field.name] = { column: hit, confidence: 0.9 };
    }
  }
  return mapping;
}

export async function classifyCostTabWithAi(
  input: ClassifyTabInput
): Promise<TabClassification> {
  const classified = await classifyDataset({
    datasetName: input.sheetName,
    columns: input.headers,
    sampleRows: input.sampleRows,
    businessContext: CLASSIFIER_CONTEXT,
  });
  const type = normalizeCostTabType(classified.detectedTable);
  if (type && classified.confidence >= 0.5) {
    return {
      type,
      confidence: classified.confidence,
      notes: classified.notes,
    };
  }
  return classifyCostTabHeuristic(input);
}

export async function mapColumnsWithAi(
  input: MapColumnsInput
): Promise<ColumnMapping> {
  const fields = targetFieldsForTab(input.tabType);
  if (fields.length === 0) return {};
  const result = await suggestColumnMappings({
    headers: input.headers,
    sampleRows: input.sampleRows,
    targetFields: [...fields],
    tableName: `cost_workbook_${input.tabType}`,
  });
  const mapping: ColumnMapping = {};
  for (const m of result.mappings) {
    if (!m.originalColumn || m.standardField === "unmapped") continue;
    mapping[m.standardField] = {
      column: m.originalColumn,
      confidence: m.confidence,
    };
  }
  if (Object.keys(mapping).length === 0) {
    return mapColumnsHeuristic(input);
  }
  return mapping;
}

export function createDefaultWorkbookAi(): WorkbookAi {
  return {
    async classifyTab(input) {
      try {
        return await classifyCostTabWithAi(input);
      } catch (err) {
        console.error("[cost-workbook classify]", err);
        return classifyCostTabHeuristic(input);
      }
    },
    async mapColumns(input) {
      try {
        return await mapColumnsWithAi(input);
      } catch (err) {
        console.error("[cost-workbook map]", err);
        return mapColumnsHeuristic(input);
      }
    },
  };
}
