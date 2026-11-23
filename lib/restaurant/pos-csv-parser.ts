// lib/restaurant/pos-csv-parser.ts
//
// Real CSV parser for sales uploads using papaparse.
// Handles quoted fields correctly ("120,00" is one cell, not two).

import Papa from "papaparse";

export interface ParsedCSV {
  headers: string[];
  rows: Record<string, unknown>[];
  headerRowIndex: number;
}

/**
 * Parse a CSV buffer with proper quote handling. Detects and skips title/summary rows.
 */
export function parseCSV(buffer: Buffer): ParsedCSV {
  const text = buffer.toString("utf-8");
  
  // Parse with papaparse for proper quote handling
  const parsed = Papa.parse(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: "", // Auto-detect
  });
  
  if (parsed.errors.length > 0) {
    console.warn("[CSV Parser] Papaparse errors:", parsed.errors);
  }
  
  const rawRows = parsed.data as string[][];
  if (rawRows.length < 2) {
    throw new Error("CSV must have at least a header row and one data row");
  }
  
  // Detect which row is the header
  let headerRowIndex = 0;
  let headers: string[] = [];
  
  // Try first 10 rows to find headers
  for (let i = 0; i < Math.min(10, rawRows.length); i++) {
    const row = rawRows[i];
    
    // Skip empty rows
    if (!row || row.length === 0 || row.every(c => !c || !c.trim())) {
      continue;
    }
    
    // Skip rows with too few cells
    if (row.length < 3) continue;
    
    // Count how many cells look like headers (non-numeric strings)
    const nonEmpty = row.filter(c => c && c.trim());
    if (nonEmpty.length < 3) continue;
    
    const lookLikeHeaders = nonEmpty.filter(c => {
      const trimmed = c.trim();
      // Headers shouldn't be just numbers or dates
      if (/^\d+([.,]\d+)?$/.test(trimmed)) return false;
      if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/.test(trimmed)) return false;
      return trimmed.length > 0;
    });
    
    // If most cells look like headers, this is probably the header row
    if (lookLikeHeaders.length >= nonEmpty.length * 0.7) {
      headerRowIndex = i;
      headers = row.map(h => (h || "").trim()).filter(h => h.length > 0);
      break;
    }
  }
  
  // If we didn't find headers, use first row
  if (headers.length === 0) {
    headerRowIndex = 0;
    headers = rawRows[0].map(h => (h || "").trim()).filter(h => h.length > 0);
  }
  
  // Convert remaining rows to objects
  const dataRows = rawRows.slice(headerRowIndex + 1);
  const rows: Record<string, unknown>[] = [];
  
  for (const dataRow of dataRows) {
    // Skip empty rows
    if (!dataRow || dataRow.length === 0 || dataRow.every(c => !c || !c.trim())) {
      continue;
    }
    
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      const value = dataRow[i];
      obj[header] = value !== undefined && value !== null ? value.trim() : "";
    }
    rows.push(obj);
  }
  
  return {
    headers,
    rows,
    headerRowIndex,
  };
}
