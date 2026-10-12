// Repeating "COSTO RESTAURANTE" recipe blocks from Los Ranchos-style
// workbooks. Banner / sheet title / per-block headers / footer rows
// are never recipe names. Totals are recomputed from qty × unit cost.

import {
  inspectCostImportNumber,
  nameKey,
  parseCostImportNumber,
} from "@/lib/restaurant/cost-import";
import type { PreferredLanguage } from "@/lib/restaurant/language";
import {
  isSubRecipePortionUnit,
  PACK_SIZE_REVIEW_REASON,
  resolveUnitCell,
} from "@/lib/restaurant/units";
import {
  ambiguousNumberReason,
  emptyRecipeNameReason,
  inferredCostTotalReason,
  missingRecipeNameReason,
  missingUnitReason,
  positiveQuantityReason,
  strayNameRowReason,
  totalMismatchReason,
  assumedYieldReason,
  yieldInconsistentReason,
  yieldUnknownReason,
} from "./copy";
import { normalizeHeaderToken } from "./header";
import { resolveRecipeLineUnit } from "./portion-unit";
import type {
  ColumnMapping,
  GroupedRecipe,
  RecipeLineCandidate,
  ReviewCandidate,
  SkipCandidate,
} from "./types";

export const SHEET_TITLE_RE = /^restaurante\s+los\s+ranchos$/i;
export const BANNER_RE = /^costo\s+restaurante$/i;
export const COSTO_TOTAL_RE = /^costo\s+total$/i;
export const PRECIO_LIBRA_RE = /^precio(\s+de)?(\s+costo)?\s+(por\s+)?libra$/i;
export const PRECIO_ONZA_RE = /^precio(\s+de)?(\s+costo)?\s+(por\s+)?onza$/i;
export const PRECIO_UNIT_RE =
  /^precio(\s+de)?(\s+costo)?\s+(por\s+)?(unidad|unitario|torta|orden|porcion)$/i;
export const PRECIO_VENTA_RE = /^precio\s+de\s+venta(\s+sin\s+iva)?$/i;
export const MARGEN_RE = /^margen\s+de\s+contribuci[oó]n$/i;
export const HASH_FILL_RE = /^#+$/;
export const TOTAL_MISMATCH_REASON = totalMismatchReason("es");
export const YIELD_INCONSISTENT_REASON = yieldInconsistentReason("es");
export const YIELD_UNKNOWN_REASON = yieldUnknownReason("es");
export const YIELD_ASSUMED_REASON = assumedYieldReason("es");

const YIELD_TOLERANCE = 0.05;
const TOTAL_ABS_TOLERANCE = 0.03;
const TOTAL_REL_TOLERANCE = 0.02;

function foldLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[$:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Footer labels in the real Los Ranchos file include typos (PRECIOPOR,
 *  UNDIAD) and extra words (PRECIO COSTO POR UNIDAD / TORTA). */
export function foldFooterLabel(raw: string): string {
  return foldLabel(raw)
    .replace(/undiad/g, "unidad")
    .replace(/preciopor/g, "precio por")
    .replace(/\s+/g, " ")
    .trim();
}

export function isHashPlaceholder(value: unknown): boolean {
  return typeof value === "string" && HASH_FILL_RE.test(value.trim());
}

export function readNumericCell(value: unknown): number | null {
  if (isHashPlaceholder(value)) return null;
  return parseCostImportNumber(value);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isHashPlaceholder(value)) return "";
  return String(value).trim();
}

function rowCells(row: unknown): unknown[] {
  return Array.isArray(row) ? row : [];
}

function firstText(cells: unknown[]): string {
  for (const cell of cells) {
    const text = cellText(cell);
    if (text) return text;
  }
  return "";
}

function isBlankRow(cells: unknown[]): boolean {
  return cells.every(
    (cell) => cellText(cell) === "" && !isHashPlaceholder(cell)
  );
}

function isSheetTitle(cells: unknown[]): boolean {
  return SHEET_TITLE_RE.test(foldLabel(firstText(cells)));
}

function isBanner(cells: unknown[]): boolean {
  return BANNER_RE.test(foldLabel(firstText(cells)));
}

function tokens(cells: unknown[]): string[] {
  return cells
    .map((cell) => normalizeHeaderToken(cellText(cell)))
    .filter(Boolean);
}

export function isRepeatingBlockHeader(cells: unknown[]): boolean {
  const set = new Set(tokens(cells));
  const hasArticulo = [...set].some((token) =>
    /^(articulo|item|nombre|ingrediente|producto)$/.test(token)
  );
  const hasUnidad = [...set].some(
    (token) => token.includes("unidad") || token === "unit" || token === "uom"
  );
  const hasCantidad = [...set].some((token) =>
    /^(cantidad|qty|quantity)$/.test(token)
  );
  const overlapName = headerOverlapName(cells);
  return (hasArticulo || Boolean(overlapName)) && hasUnidad && hasCantidad;
}

export function headerOverlap(
  cells: unknown[]
): { name: string; index: number } | null {
  for (const [index, cell] of cells.entries()) {
    const first = cellText(cell);
    if (!first) continue;
    const token = normalizeHeaderToken(first);
    if (/^(articulo|item|nombre|ingrediente|producto)$/.test(token)) {
      return null;
    }
    const restLooksLikeHeader = cells.slice(index + 1).some((other) => {
      const t = normalizeHeaderToken(cellText(other));
      return t.includes("unidad") || t === "cantidad" || t.includes("costo");
    });
    return restLooksLikeHeader ? { name: first, index } : null;
  }
  return null;
}

export function headerOverlapName(cells: unknown[]): string | null {
  return headerOverlap(cells)?.name ?? null;
}

type FooterKind =
  | "costo_total"
  | "precio_lb"
  | "precio_oz"
  | "precio_unit"
  | "precio_venta"
  | "margen";

/** Drop a trailing amount so "PRECIO POR LIBRA $0.42" still matches. */
export function stripFooterAmount(raw: string): string {
  return foldFooterLabel(raw)
    .replace(/(?:^|\s)\$?\d+(?:[.,]\d+)?$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function footerKindFromLabel(raw: string): FooterKind | null {
  const label = stripFooterAmount(raw);
  if (COSTO_TOTAL_RE.test(label)) return "costo_total";
  if (PRECIO_LIBRA_RE.test(label)) return "precio_lb";
  if (PRECIO_ONZA_RE.test(label)) return "precio_oz";
  if (PRECIO_UNIT_RE.test(label)) return "precio_unit";
  if (PRECIO_VENTA_RE.test(label)) return "precio_venta";
  if (MARGEN_RE.test(label)) return "margen";
  return null;
}

function footerKind(cells: unknown[]): FooterKind | null {
  // Real files fill the recipe name down column A, so the footer label
  // is often the second text cell, not the first.
  for (const cell of cells) {
    const text = cellText(cell);
    if (!text) continue;
    const kind = footerKindFromLabel(text);
    if (kind) return kind;
  }
  return null;
}

function numberFromFooterLabel(raw: string): number | null {
  if (!footerKindFromLabel(raw)) return null;
  const folded = foldFooterLabel(raw);
  const match = folded.match(/\$?(\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  return parseCostImportNumber(match[1]);
}

/** Prefer the Total Costo column, then a label+value cell, then the last
 *  positive number. `firstNumber` used to grab a 0 in Cantidad and store
 *  that as COSTO TOTAL, which made every yield fail. */
export function footerAmount(cells: unknown[], cols?: Cols): number | null {
  if (cols) {
    const fromTotal = readNumericCell(cells[cols.total]);
    if (fromTotal != null && fromTotal > 0) return fromTotal;
  }
  let embedded: number | null = null;
  for (const cell of cells) {
    const n = numberFromFooterLabel(cellText(cell));
    if (n != null && n > 0) embedded = n;
  }
  if (embedded != null) return embedded;
  let last: number | null = null;
  for (const cell of cells) {
    const n = readNumericCell(cell);
    if (n != null && n > 0) last = n;
  }
  return last;
}

function isIgnorableNameRowExtra(cell: unknown): boolean {
  if (cellText(cell) === "") return true;
  if (isHashPlaceholder(cell)) return true;
  const n = readNumericCell(cell);
  return n === 0;
}

function isNameRow(cells: unknown[]): boolean {
  const texts = cells
    .filter((cell) => !isIgnorableNameRowExtra(cell))
    .map(cellText);
  if (texts.length !== 1) return false;
  const label = foldLabel(texts[0] ?? "");
  if (!label) return false;
  if (isBanner(cells) || isSheetTitle(cells) || footerKind(cells)) return false;
  if (isRepeatingBlockHeader(cells)) return false;
  if (readNumericCell(texts[0]) !== null) return false;
  return true;
}

interface Cols {
  ingredient: number;
  unit: number;
  qty: number;
  unitCost: number;
  total: number;
}

export function columnsFromBlockHeader(cells: unknown[]): Cols {
  const cols: Cols = {
    ingredient: 0,
    unit: 1,
    qty: 2,
    unitCost: 3,
    total: 4,
  };
  const overlap = headerOverlap(cells);
  if (overlap) cols.ingredient = overlap.index;
  cells.forEach((cell, index) => {
    const token = normalizeHeaderToken(cellText(cell));
    if (!token) return;
    if (/^(articulo|item|nombre|ingrediente|producto)$/.test(token)) {
      cols.ingredient = index;
    } else if (
      token.includes("unidad") ||
      token === "unit" ||
      token === "uom"
    ) {
      cols.unit = index;
    } else if (/^(cantidad|qty|quantity)$/.test(token)) {
      cols.qty = index;
    } else if (
      token.includes("costounitario") ||
      token.includes("preciounitario") ||
      token === "costounit"
    ) {
      cols.unitCost = index;
    } else if (token.includes("total")) {
      cols.total = index;
    }
  });
  return cols;
}

export function mappingFromCostoRestauranteHeader(
  aoa: unknown[][]
): ColumnMapping {
  for (const row of aoa) {
    const cells = rowCells(row);
    if (!isRepeatingBlockHeader(cells)) continue;
    const cols = columnsFromBlockHeader(cells);
    const label = (index: number, fallback: string) =>
      cellText(cells[index]) && !headerOverlapName(cells)
        ? cellText(cells[index])
        : fallback;
    const ingredientLabel = headerOverlapName(cells)
      ? "Articulo"
      : label(cols.ingredient, "Articulo");
    return {
      ingredient_name: { column: ingredientLabel, confidence: 0.92 },
      unit: {
        column: label(cols.unit, "Unidad Detalle"),
        confidence: 0.92,
      },
      quantity: { column: label(cols.qty, "Cantidad"), confidence: 0.92 },
    };
  }
  return {};
}

export function sheetLooksLikeCostoRestauranteBlocks(
  aoa: unknown[][]
): boolean {
  let banners = 0;
  let headers = 0;
  for (const row of aoa) {
    const cells = rowCells(row);
    if (isBanner(cells)) banners += 1;
    if (isRepeatingBlockHeader(cells)) headers += 1;
  }
  return headers >= 2 || (banners >= 1 && headers >= 1);
}

function totalsMatch(expected: number, actual: number): boolean {
  const tol = TOTAL_ABS_TOLERANCE + Math.abs(expected) * TOTAL_REL_TOLERANCE;
  return Math.abs(expected - actual) <= tol;
}

function deriveYield(
  input: {
    costTotal: number | null;
    pricePerLb: number | null;
    pricePerOz: number | null;
    pricePerUnit: number | null;
  },
  lang: PreferredLanguage
):
  | { ok: true; quantity: number; unit: string; assumed?: boolean }
  | { ok: false; reason: string } {
  const { costTotal, pricePerLb, pricePerOz, pricePerUnit } = input;
  if (costTotal == null || costTotal <= 0) {
    return { ok: false, reason: yieldUnknownReason(lang) };
  }
  const fromLb =
    pricePerLb != null && pricePerLb > 0 ? costTotal / pricePerLb : null;
  const fromOz =
    pricePerOz != null && pricePerOz > 0 ? costTotal / pricePerOz : null;
  const fromUnit =
    pricePerUnit != null && pricePerUnit > 0 ? costTotal / pricePerUnit : null;
  if (fromLb != null && fromOz != null) {
    const ozAsLb = fromOz / 16;
    const rel = Math.abs(fromLb - ozAsLb) / Math.max(fromLb, ozAsLb);
    const priceRel =
      pricePerLb != null && pricePerOz != null
        ? Math.abs(pricePerOz * 16 - pricePerLb) / pricePerLb
        : 1;
    if (rel > YIELD_TOLERANCE && priceRel > YIELD_TOLERANCE) {
      return { ok: false, reason: yieldInconsistentReason(lang) };
    }
    return { ok: true, quantity: fromLb, unit: "lb" };
  }
  if (fromLb != null) return { ok: true, quantity: fromLb, unit: "lb" };
  if (fromOz != null) return { ok: true, quantity: fromOz, unit: "oz" };
  if (fromUnit != null) return { ok: true, quantity: fromUnit, unit: "unit" };
  // Per-order preps (QUESO FRITO) print COSTO TOTAL and no $/lb. One
  // batch is one unit / one ORDEN — assumed, never a confirmed yield.
  return { ok: true, assumed: true, quantity: 1, unit: "unit" };
}

interface OpenBlock {
  name: string;
  startRowIndex: number;
  headerSeen: boolean;
  cols: Cols;
  lines: RecipeLineCandidate[];
  costTotal: number | null;
  inferredCostTotal: number | null;
  costTotalInferred: boolean;
  pricePerLb: number | null;
  pricePerOz: number | null;
  pricePerUnit: number | null;
  sellingPrice: number | null;
  incompleteLines: boolean;
}

function looksLikeUnitCell(raw: string): boolean {
  if (!raw) return false;
  if (isSubRecipePortionUnit(raw)) return true;
  const resolved = resolveUnitCell(raw);
  if (resolved.ok) return true;
  return resolved.reason === PACK_SIZE_REVIEW_REASON;
}

function cellLooksLikeQuantity(value: unknown): boolean {
  const inspected = inspectCostImportNumber(value);
  if (inspected.kind === "ok") return inspected.value > 0;
  return inspected.kind === "ambiguous";
}

/** Filled-down recipe name in column A adds an extra cell, so Articulo
 *  lands in the unit column unless we shift one to the right. */
export function alignFilledDownBlockRow(
  cells: unknown[],
  cols: Cols,
  recipeName: string
): {
  name: string;
  unitRaw: string;
  qty: number | null;
  qtyRaw: unknown;
  unitCost: number | null;
  printedTotal: number | null;
} {
  const read = (offset: number) => ({
    name: cellText(cells[cols.ingredient + offset]),
    unitRaw: cellText(cells[cols.unit + offset]),
    qty: readNumericCell(cells[cols.qty + offset]),
    qtyRaw: cells[cols.qty + offset],
    unitCost: readNumericCell(cells[cols.unitCost + offset]),
    printedTotal: readNumericCell(cells[cols.total + offset]),
  });
  const looksLikeLine = (row: ReturnType<typeof read>) =>
    Boolean(row.name) &&
    looksLikeUnitCell(row.unitRaw) &&
    cellLooksLikeQuantity(row.qtyRaw);
  let offset = 0;
  let base = read(0);
  if (!base.name) {
    const next = read(1);
    if (next.name) {
      base = next;
      offset = 1;
    }
  }
  if (!recipeName || nameKey(base.name) !== nameKey(recipeName)) return base;
  const shifted = read(offset + 1);
  if (!shifted.name) return base;
  const baseLooksLikeLine = looksLikeLine(base);
  const shiftedLooksLikeLine = looksLikeLine(shifted);
  if (shiftedLooksLikeLine && !baseLooksLikeLine) return shifted;
  if (shiftedLooksLikeLine && nameKey(shifted.name) !== nameKey(recipeName)) {
    return shifted;
  }
  return base;
}

function inferCostTotalFromLines(lines: RecipeLineCandidate[]): number | null {
  let sum = 0;
  let any = false;
  for (const line of lines) {
    const printed = readNumericCell(line.raw["Total Costo"]);
    if (printed != null && printed > 0) {
      sum += printed;
      any = true;
      continue;
    }
    const unitCost = readNumericCell(line.raw["Costo Unitario"]);
    const qty = readNumericCell(line.raw.Cantidad);
    if (unitCost != null && qty != null && unitCost > 0 && qty > 0) {
      sum += unitCost * qty;
      any = true;
    }
  }
  return any && sum > 0 ? sum : null;
}

export function collectCostoRestauranteBlockNames(aoa: unknown[][]): string[] {
  const names: string[] = [];
  let phase: "idle" | "after_banner" | "in_block" = "idle";
  for (const row of aoa) {
    const cells = rowCells(row);
    if (isBlankRow(cells) || isSheetTitle(cells)) continue;
    if (isBanner(cells)) {
      phase = "after_banner";
      continue;
    }
    if (footerKind(cells)) continue;
    if (isRepeatingBlockHeader(cells)) {
      const overlap = headerOverlapName(cells);
      if (overlap) names.push(overlap);
      phase = "in_block";
      continue;
    }
    if (isNameRow(cells) && (phase === "idle" || phase === "after_banner")) {
      names.push(firstText(cells));
      phase = "in_block";
    }
  }
  return names;
}

export function collectCostoRestauranteBlocks(input: {
  tabName: string;
  tabKind: "recipe" | "sub_recipe";
  aoa: unknown[][];
  knownSubRecipeNames?: Iterable<string>;
  lang?: PreferredLanguage;
}): {
  groups: GroupedRecipe[];
  review: ReviewCandidate[];
  skipped: SkipCandidate[];
} {
  const lang = input.lang ?? "en";
  const knownSubRecipeNames = [...(input.knownSubRecipeNames ?? [])];
  const review: ReviewCandidate[] = [];
  const skipped: SkipCandidate[] = [];
  const groups: GroupedRecipe[] = [];
  const open: { block: OpenBlock | null } = { block: null };
  let pendingName = "";
  let phase: "idle" | "after_banner" | "in_block" = "idle";
  let cols: Cols = {
    ingredient: 0,
    unit: 1,
    qty: 2,
    unitCost: 3,
    total: 4,
  };

  const close = () => {
    const current = open.block;
    if (!current) {
      pendingName = "";
      return;
    }
    if (current.lines.length === 0) {
      if (current.name) {
        skipped.push({
          tabName: input.tabName,
          rowIndex: current.startRowIndex,
          reason: emptyRecipeNameReason(lang),
          raw: { recipe: current.name },
        });
      }
      open.block = null;
      pendingName = "";
      return;
    }
    if (current.costTotal == null || current.costTotal <= 0) {
      const inferred = inferCostTotalFromLines(current.lines);
      if (inferred != null) {
        current.inferredCostTotal = inferred;
        current.costTotalInferred = true;
      }
    }
    const yieldSource = current.costTotalInferred
      ? current.inferredCostTotal
      : current.costTotal;
    const yieldResult = deriveYield(
      {
        costTotal: yieldSource,
        pricePerLb: current.pricePerLb,
        pricePerOz: current.pricePerOz,
        pricePerUnit: current.pricePerUnit,
      },
      lang
    );
    const assumed = Boolean(
      (yieldResult.ok && yieldResult.assumed) ||
      (yieldResult.ok && current.costTotalInferred)
    );
    if (input.tabKind === "sub_recipe") {
      if (current.costTotalInferred && yieldResult.ok) {
        review.push({
          tabName: input.tabName,
          rowIndex: current.startRowIndex,
          reason: inferredCostTotalReason(lang, current.name),
          raw: {
            recipe: current.name,
            inferred_cost_total: current.inferredCostTotal,
          },
          suggested: { ingredient_name: current.name },
        });
      } else if (assumed) {
        review.push({
          tabName: input.tabName,
          rowIndex: current.startRowIndex,
          reason: `${assumedYieldReason(lang)} (${current.name})`,
          raw: { recipe: current.name },
          suggested: { ingredient_name: current.name },
        });
      } else if (!yieldResult.ok) {
        review.push({
          tabName: input.tabName,
          rowIndex: current.startRowIndex,
          reason: `${yieldResult.reason} (${current.name})`,
          raw: { recipe: current.name },
          suggested: { ingredient_name: current.name },
        });
      }
    }
    groups.push({
      name: current.name,
      tabName: input.tabName,
      kind: input.tabKind,
      lines: current.lines,
      output_quantity: yieldResult.ok ? yieldResult.quantity : null,
      output_unit: yieldResult.ok ? yieldResult.unit : null,
      block_layout: true,
      yield_assumed: assumed || undefined,
      selling_price: current.sellingPrice,
      cost_total: current.costTotal,
      inferred_cost_total: current.inferredCostTotal,
      cost_total_inferred: current.costTotalInferred || undefined,
      price_per_lb: current.pricePerLb,
      price_per_oz: current.pricePerOz,
      price_per_unit: current.pricePerUnit,
      incomplete_lines: current.incompleteLines,
      start_row_index: current.startRowIndex,
    });
    open.block = null;
    pendingName = "";
  };

  const start = (name: string, rowIndex: number) => {
    const current = open.block;
    if (current && (current.lines.length > 0 || current.name)) close();
    open.block = {
      name: name.trim(),
      startRowIndex: rowIndex,
      headerSeen: false,
      cols,
      lines: [],
      costTotal: null,
      inferredCostTotal: null,
      costTotalInferred: false,
      pricePerLb: null,
      pricePerOz: null,
      pricePerUnit: null,
      sellingPrice: null,
      incompleteLines: false,
    };
    phase = "in_block";
    pendingName = "";
  };

  for (const [rowIndex, row] of input.aoa.entries()) {
    const cells = rowCells(row);
    if (isBlankRow(cells)) continue;
    if (isSheetTitle(cells)) {
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: "header/total row",
        raw: { title: firstText(cells) },
      });
      continue;
    }
    if (isBanner(cells)) {
      close();
      pendingName = "";
      phase = "after_banner";
      continue;
    }
    const footer = footerKind(cells);
    if (footer) {
      const amount = footerAmount(cells, open.block?.cols ?? cols);
      if (open.block && amount != null) {
        if (footer === "costo_total") open.block.costTotal = amount;
        if (footer === "precio_lb") open.block.pricePerLb = amount;
        if (footer === "precio_oz") open.block.pricePerOz = amount;
        if (footer === "precio_unit") open.block.pricePerUnit = amount;
        if (footer === "precio_venta") open.block.sellingPrice = amount;
      }
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: "header/total row",
        raw: { footer: firstText(cells) },
      });
      continue;
    }
    if (isRepeatingBlockHeader(cells)) {
      cols = columnsFromBlockHeader(cells);
      const overlap = headerOverlapName(cells);
      if (overlap) {
        if (!open.block || nameKey(open.block.name) !== nameKey(overlap)) {
          start(overlap, rowIndex);
        }
      } else if (!open.block) {
        if (pendingName) start(pendingName, rowIndex);
        else if (phase === "idle" || phase === "after_banner") {
          start("", rowIndex);
        }
      }
      if (open.block) {
        open.block.cols = cols;
        open.block.headerSeen = true;
        if (overlap && !open.block.name) open.block.name = overlap;
      }
      phase = "in_block";
      pendingName = "";
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: "header/total row",
        raw: { header: firstText(cells) },
      });
      continue;
    }
    if (isNameRow(cells)) {
      const name = firstText(cells);
      if (phase === "idle" || phase === "after_banner") {
        pendingName = name;
        start(name, rowIndex);
        continue;
      }
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: strayNameRowReason(lang),
        raw: { name },
      });
      continue;
    }

    const aligned = alignFilledDownBlockRow(
      cells,
      open.block?.cols ?? cols,
      open.block?.name || pendingName
    );
    const name = aligned.name;
    const unitRaw = aligned.unitRaw;
    const qty = aligned.qty;
    const qtyInspected = inspectCostImportNumber(aligned.qtyRaw);
    const unitCost = aligned.unitCost;
    const printedTotal = aligned.printedTotal;
    if (!name) {
      skipped.push({
        tabName: input.tabName,
        rowIndex,
        reason: "blank",
        raw: { row: cells },
      });
      continue;
    }
    if (!open.block || !open.block.name) {
      if (pendingName) start(pendingName, rowIndex);
    }
    if (!open.block?.name) {
      review.push({
        tabName: input.tabName,
        rowIndex,
        reason: missingRecipeNameReason(lang),
        raw: { Articulo: name, Unidad: unitRaw, Cantidad: qty },
        suggested: { ingredient_name: name, unit: unitRaw || undefined },
      });
      continue;
    }
    const current = open.block;

    const resolvedUnit = unitRaw
      ? resolveRecipeLineUnit({
          unitRaw,
          ingredientName: name,
          knownSubRecipeNames,
          lang,
        })
      : { ok: false as const, reason: missingUnitReason(lang) };
    if (!resolvedUnit.ok) {
      current.incompleteLines = true;
      review.push({
        tabName: input.tabName,
        rowIndex,
        reason: resolvedUnit.reason,
        raw: { Articulo: name, Unidad: unitRaw, Cantidad: qty },
        suggested: { ingredient_name: name, unit: unitRaw || undefined },
      });
      continue;
    }
    if (qtyInspected.kind === "ambiguous") {
      current.incompleteLines = true;
      review.push({
        tabName: input.tabName,
        rowIndex,
        reason: ambiguousNumberReason(lang, qtyInspected.raw),
        raw: { Articulo: name, Unidad: unitRaw, Cantidad: qtyInspected.raw },
        suggested: { ingredient_name: name, unit: unitRaw },
      });
      continue;
    }
    if (qty === null || qty <= 0) {
      current.incompleteLines = true;
      review.push({
        tabName: input.tabName,
        rowIndex,
        reason: positiveQuantityReason(lang),
        raw: { Articulo: name, Unidad: unitRaw, Cantidad: qty },
        suggested: { ingredient_name: name, unit: unitRaw },
      });
      continue;
    }
    if (unitCost != null && printedTotal != null) {
      const expected = qty * unitCost;
      if (!totalsMatch(expected, printedTotal)) {
        review.push({
          tabName: input.tabName,
          rowIndex,
          reason: totalMismatchReason(lang),
          raw: {
            Articulo: name,
            Cantidad: qty,
            unit_cost: unitCost,
            total: printedTotal,
          },
          suggested: { ingredient_name: name, quantity: qty, unit: unitRaw },
        });
      }
    }

    const line: RecipeLineCandidate = {
      tabName: input.tabName,
      rowIndex,
      recipeName: current.name,
      ingredient_name: name,
      quantity: qty * resolvedUnit.quantityMultiplier,
      unit:
        resolvedUnit.quantityMultiplier !== 1 ||
        resolvedUnit.canonical === "portion"
          ? resolvedUnit.unit
          : unitRaw,
      raw: {
        Articulo: name,
        "Unidad Detalle": unitRaw,
        Cantidad: qty,
        "Costo Unitario": unitCost,
        "Total Costo": printedTotal,
      },
    };
    current.lines.push(line);
  }
  close();

  return {
    groups: groups.filter((group) => group.name && group.lines.length > 0),
    review,
    skipped,
  };
}
