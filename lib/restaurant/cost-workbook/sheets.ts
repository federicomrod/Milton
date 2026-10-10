import * as XLSX from "xlsx";
import {
  detectHeaderRow,
  headerFingerprint,
  layoutKeyForHeaders,
  rowsToObjects,
} from "./header";
import type { DetectedSheet } from "./types";

export function shouldUseWorkbookImport(
  isCsv: boolean,
  columnsOk: boolean
): boolean {
  return !isCsv && !columnsOk;
}

export function readWorkbookSheets(buffer: Buffer): DetectedSheet[] {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });
  const sheets: DetectedSheet[] = [];
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
    }) as unknown[][];
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
