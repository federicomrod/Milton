import { parseCostImportNumber } from "@/lib/restaurant/cost-import";
import type { ColumnMapping } from "./types";

export function textAt(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: string
): string | null {
  const col = mapping[field]?.column;
  if (!col) return null;
  const raw = row[col];
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

export function numberAt(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  field: string
): number | null {
  const col = mapping[field]?.column;
  if (!col) return null;
  return parseCostImportNumber(row[col]);
}

export function rowIsBlank(row: Record<string, unknown>): boolean {
  return Object.values(row).every((value) => String(value ?? "").trim() === "");
}
