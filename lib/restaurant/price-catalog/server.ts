// Server helpers shared by the price-catalog routes. The company always
// comes from auth, never from the request.

import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import { collectWorkbookCandidateBlocks } from "@/lib/restaurant/cost-workbook/collect-blocks";
import {
  readWorkbookSheetsFromWorkbook,
  readXlsxWorkbook,
} from "@/lib/restaurant/cost-workbook/sheets";
import type { RecipeCostObservation } from "./conflicts";
import { findPriceCatalog, type PriceCatalogRead } from "./reader";

export const MAX_CATALOG_FILE_BYTES = 15 * 1024 * 1024;

export interface ReadCatalogResult {
  read: PriceCatalogRead | null;
  observations: RecipeCostObservation[];
}

/** Read the price list and the recipe-line costs out of one workbook. */
export function readCatalogFromBuffer(buffer: Buffer): ReadCatalogResult {
  const sheets = readWorkbookSheetsFromWorkbook(readXlsxWorkbook(buffer));
  const read = findPriceCatalog(sheets);
  if (!read) return { read: null, observations: [] };

  const observations: RecipeCostObservation[] = [];
  for (const block of collectWorkbookCandidateBlocks({ buffer, lang: "es" })
    .all) {
    for (const line of block.lines) {
      const raw = (line.raw ?? {}) as Record<string, unknown>;
      const cost = parseCostImportNumber(
        raw["Costo Unitario"] ?? raw.Costo ?? raw.unit_cost
      );
      if (cost === null || !(cost > 0)) continue;
      observations.push({
        name: line.ingredient_name,
        unitLabel: String(raw["Unidad Detalle"] ?? line.unit ?? ""),
        unitCost: cost,
        tab: block.tabName,
        row: line.rowIndex,
        recipe: block.name,
      });
    }
  }
  return { read, observations };
}
