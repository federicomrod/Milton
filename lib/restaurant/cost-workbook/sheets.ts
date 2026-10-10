import * as XLSX from "xlsx";
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

export function shouldUseWorkbookImport(
  isCsv: boolean,
  columnsOk: boolean
): boolean {
  return !isCsv && !columnsOk;
}

export function readXlsxWorkbook(buffer: Buffer): XLSX.WorkBook {
  return XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });
}

export function firstSheetRawRows(workbook: XLSX.WorkBook): {
  headers: string[];
  rawRows: Record<string, unknown>[];
} {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rawRows: [] };
  const ws = workbook.Sheets[sheetName];
  if (!ws) return { headers: [], rawRows: [] };
  const rawRows = XLSX.utils.sheet_to_json(ws, {
    raw: true,
    defval: "",
  }) as Record<string, unknown>[];
  const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  return { headers, rawRows };
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
    if (!detected) continue;
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
    });
  }
  return sheets;
}

export function readWorkbookSheets(buffer: Buffer): DetectedSheet[] {
  return readWorkbookSheetsFromWorkbook(readXlsxWorkbook(buffer));
}

export function isWorkbookLimitError(err: unknown): err is WorkbookLimitError {
  return err instanceof WorkbookLimitError;
}
