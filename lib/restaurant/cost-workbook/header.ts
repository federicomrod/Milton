// Find the real header row in a sheet that may start with titles / blanks.

import { createHash } from "node:crypto";

const HEADER_TOKENS = new Set([
  "item",
  "nombre",
  "producto",
  "ingrediente",
  "ingredient",
  "articulo",
  "artículo",
  "unidad",
  "unit",
  "uom",
  "medida",
  "costo",
  "coste",
  "precio",
  "price",
  "cost",
  "cantidad",
  "quantity",
  "qty",
  "total",
  "importe",
  "amount",
  "libra",
  "onza",
  "lb",
  "oz",
  "preciounitario",
  "supplier",
  "proveedor",
  "fecha",
  "date",
]);

export function normalizeHeaderToken(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_\-/]+/g, "");
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isNumericCell(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) return true;
  const t = cellText(value);
  if (!t) return false;
  return /^-?\d+(?:[.,]\d+)?$/.test(t);
}

function scoreHeaderRow(row: unknown[]): number {
  let score = 0;
  let strings = 0;
  let numbers = 0;
  let tokens = 0;
  for (const cell of row) {
    const text = cellText(cell);
    if (!text) continue;
    if (isNumericCell(cell)) {
      numbers += 1;
      score -= 2;
      continue;
    }
    strings += 1;
    score += 1;
    const token = normalizeHeaderToken(text);
    if (
      HEADER_TOKENS.has(token) ||
      [...HEADER_TOKENS].some((t) => token.includes(t))
    ) {
      tokens += 1;
      score += 3;
    }
  }
  if (strings === 0) return -100;
  if (tokens === 0 && numbers > strings) return -50;
  return score;
}

export interface HeaderDetection {
  headerRowIndex: number;
  headers: string[];
}

/**
 * Scan the first `scan` rows of an AOA sheet and pick the best header
 * row. Title rows and blanks score poorly; a row with ITEM/LIBRA or
 * Nombre/Unidad/Costo wins.
 */
export function detectHeaderRow(
  rows: unknown[][],
  scan = 20
): HeaderDetection | null {
  let best: { index: number; score: number } | null = null;
  const limit = Math.min(rows.length, scan);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? [];
    const score = scoreHeaderRow(row);
    if (!best || score > best.score) best = { index: i, score };
  }
  if (!best || best.score < 3) return null;
  const raw = (rows[best.index] ?? []).map((c) => cellText(c));
  let last = raw.length - 1;
  while (last >= 0 && !raw[last]) last -= 1;
  const headers = raw.slice(0, last + 1);
  if (headers.filter(Boolean).length < 2) return null;
  return { headerRowIndex: best.index, headers };
}

export function rowsToObjects(
  rows: unknown[][],
  headerRowIndex: number,
  headers: string[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const obj: Record<string, unknown> = {};
    let any = false;
    headers.forEach((header, col) => {
      if (!header) return;
      const value = row[col];
      obj[header] = value ?? "";
      if (cellText(value) !== "") any = true;
    });
    if (any) out.push(obj);
  }
  return out;
}

export function headerFingerprint(headers: string[]): string {
  const normalized = headers
    .map((h) => normalizeHeaderToken(h))
    .filter(Boolean)
    .join("|");
  return createHash("sha256").update(normalized).digest("hex");
}

export function layoutKeyForHeaders(headers: string[]): string {
  return headerFingerprint(headers);
}
