import * as XLSX from "xlsx";
import {
  mappingFromCostoRestauranteHeader,
  sheetLooksLikeCostoRestauranteBlocks,
} from "./blocks";
import {
  detectHeaderRow,
  headerFingerprint,
  layoutKeyForHeaders,
  rowsToObjects,
} from "./header";
import { assertWorkbookLimits, WorkbookLimitError } from "./limits";
import type { DetectedSheet } from "./types";

export {
  MAX_ROWS_PER_SHEET,
  MAX_WORKBOOK_CELLS,
  MAX_WORKBOOK_TABS,
  WorkbookLimitError,
} from "./limits";

export function readXlsxWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });
}

export function readWorkbookSheetsFromWorkbook(
  workbook: XLSX.WorkBook
): DetectedSheet[] {
  const rowsPerSheet: number[] = [];
  let cellCount = 0;
  const parsed: Array<{
    name: string;
    aoa: unknown[][];
  }> = [];

  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
    }) as unknown[][];
    rowsPerSheet.push(aoa.length);
    cellCount += aoa.reduce(
      (sum, row) => sum + (Array.isArray(row) ? row.length : 0),
      0
    );
    parsed.push({ name, aoa });
  }

  assertWorkbookLimits({
    tabCount: workbook.SheetNames.length,
    rowsPerSheet,
    cellCount,
  });

  const sheets: DetectedSheet[] = [];
  for (const { name, aoa } of parsed) {
    const detected = detectHeaderRow(aoa);
    if (!detected) {
      if (sheetLooksLikeCostoRestauranteBlocks(aoa)) {
        const mapping = mappingFromCostoRestauranteHeader(aoa);
        const headers = [
          mapping.ingredient_name?.column,
          mapping.unit?.column,
          mapping.quantity?.column,
        ].filter((header): header is string => Boolean(header));
        sheets.push({
          name,
          headerRowIndex: 0,
          headers,
          dataRows: [],
          sampleRows: [],
          headerFingerprint: headerFingerprint(headers),
          layoutKey: layoutKeyForHeaders(headers),
          aoa,
        });
        continue;
      }
      sheets.push({
        name,
        headerRowIndex: 0,
        headers: [],
        dataRows: [],
        sampleRows: [],
        headerFingerprint: headerFingerprint([]),
        layoutKey: layoutKeyForHeaders([]),
        emptyReason: "no header row",
        aoa,
      });
      continue;
    }
    const dataRows = rowsToObjects(
      aoa,
      detected.headerRowIndex,
      detected.headers
    );
    sheets.push({
      name,
      headerRowIndex: detected.headerRowIndex,
      headers: detected.headers,
      dataRows,
      sampleRows: dataRows.slice(0, 3),
      headerFingerprint: headerFingerprint(detected.headers),
      layoutKey: layoutKeyForHeaders(detected.headers),
      aoa,
    });
  }
  return sheets;
}

export function isWorkbookLimitError(err: unknown): err is WorkbookLimitError {
  return err instanceof WorkbookLimitError;
}
