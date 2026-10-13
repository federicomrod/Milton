// Translate a "COSTO RESTAURANTE" workbook into the canonical recipe
// table. Plain code, no AI, nothing written. Every recipe block on every
// tab is read where it sits: a title, a header row (Articulo / Unidad
// Detalle / Cantidad / Costo Unitario / Total Costo), the lines, then
// COSTO TOTAL / PRECIO POR … / PRECIO DE VENTA SIN IVA rows.
//
// The file is never "fixed": odd lines are imported as written and
// flagged. A cost that is #ERROR!, empty or $0 is Pendiente (null).

import * as XLSX from "xlsx";
import { normalizeMatchName } from "@/lib/restaurant/cost-workbook/names";
import { normalizeUnit } from "@/lib/restaurant/units";
import {
  EXCEL_MATCH_TOLERANCE,
  type CanonicalFlag,
  type CanonicalKind,
  type CanonicalLine,
  type CanonicalRecipe,
  type CanonicalWorkbook,
} from "./types";

/** Tabs whose blocks are preparations (sub-recipes, side choices). */
const PREPARATION_TAB_RE = /sub\s*recetas?|guarnici/i;
const EVENTS_TAB_RE = /evento/i;

const TOTAL_RE = /^COSTO TOTA/;
const PER_UNIT_RE = /^PRECIO POR (.+)$/;
const SALE_RE = /^PRECIO DE VENTA/;
const MARGIN_RE = /^MARGEN/;
const BANNER_RE = /^(COSTO RESTAURANTE|RESTAURANTE\b)/;
/** Unit costs within this share of each other are the same price. */
const COST_SAME_SHARE = 0.01;

/** Portion-style units a kitchen file uses; costed per line, never converted. */
const PORTION_UNITS = new Set([
  "ORDEN",
  "ORDENES",
  "CONVOY",
  "TAZA",
  "TAZAS",
  "HOJA",
  "HOJAS",
  "LASCA",
  "LASCAS",
  "PAQUETE",
  "PAQUETES",
  "SOBRE",
  "SOBRES",
  "PORCION",
  "PORCIONES",
]);

export function fold(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

interface Cell {
  v: unknown;
  t: string | null;
  f: string | null;
}

function cellAt(ws: XLSX.WorkSheet, r: number, c: number): Cell {
  const raw = ws[XLSX.utils.encode_cell({ r, c })] as
    | XLSX.CellObject
    | undefined;
  return {
    v: raw?.v ?? null,
    t: raw?.t ?? null,
    f: typeof raw?.f === "string" ? raw.f : null,
  };
}

function addr(r: number, c: number): string {
  return XLSX.utils.encode_cell({ r, c });
}

function isErrorCell(cell: Cell): boolean {
  return (
    cell.t === "e" || (typeof cell.v === "string" && /^#/.test(cell.v.trim()))
  );
}

function numberOf(cell: Cell): number | null {
  if (isErrorCell(cell)) return null;
  if (typeof cell.v === "number" && Number.isFinite(cell.v)) return cell.v;
  if (typeof cell.v === "string") {
    const text = cell.v.trim().replace(/[$,\s]/g, "");
    if (!text) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** "SUM('SUB RECETAS 2'!F341)" / "+E18" / "SUM(E9)" → one cell, else null. */
export function singleRef(
  formula: string | null,
  currentSheet: string
): { sheet: string; cell: string } | null {
  if (!formula) return null;
  let text = formula.trim().replace(/^=/, "").replace(/^\+/, "").trim();
  const sum = text.match(/^SUM\((.*)\)$/i);
  if (sum) text = sum[1].trim();
  const hit = text.match(
    /^(?:(?:'((?:[^']|'')+)'|([A-Za-z0-9_ .]+))!)?\$?([A-Z]{1,3})\$?(\d+)$/
  );
  if (!hit) return null;
  const sheet = (hit[1]?.replace(/''/g, "'") ?? hit[2] ?? currentSheet).trim();
  return { sheet, cell: `${hit[3]}${hit[4]}` };
}

/** Rows covered by "SUM(F8:G18)" on the same sheet, else null. */
export function sumRowRange(
  formula: string | null
): { from: number; to: number } | null {
  if (!formula) return null;
  const hit = formula
    .replace(/^=/, "")
    .match(/^\+?SUM\(\$?[A-Z]{1,3}\$?(\d+):\$?[A-Z]{1,3}\$?(\d+)\)$/i);
  if (!hit) return null;
  return { from: Number(hit[1]), to: Number(hit[2]) };
}

interface HeaderAt {
  row: number;
  col: number;
  unitCol: number;
  qtyCol: number;
  costCol: number;
  totalCol: number;
  titleRow: number | null;
  title: string | null;
}

function findHeaders(ws: XLSX.WorkSheet, range: XLSX.Range): HeaderAt[] {
  const headers: HeaderAt[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const label = fold(cellAt(ws, r, c).v);
      if (label !== "ARTICULO" && label !== "ARTICULOS") continue;
      const right = (k: number) => fold(cellAt(ws, r, c + k).v);
      let unitCol = -1;
      let qtyCol = -1;
      let costCol = -1;
      let totalCol = -1;
      for (let k = 1; k <= 6; k++) {
        const text = right(k);
        if (unitCol < 0 && text.startsWith("UNIDAD")) unitCol = c + k;
        else if (qtyCol < 0 && text.startsWith("CANTIDAD")) qtyCol = c + k;
        else if (costCol < 0 && text.startsWith("COSTO UNITARIO"))
          costCol = c + k;
        else if (totalCol < 0 && /^(TOTAL COSTO|COSTO TOTAL)/.test(text))
          totalCol = c + k;
      }
      if (qtyCol < 0 || costCol < 0) continue;
      // The title is the nearest text above, in the same column.
      let titleRow: number | null = null;
      let title: string | null = null;
      for (let up = r - 1; up >= Math.max(range.s.r, r - 3); up--) {
        const text = clean(cellAt(ws, up, c).v);
        if (!text) continue;
        if (BANNER_RE.test(fold(text))) continue;
        titleRow = up;
        title = text;
        break;
      }
      headers.push({
        row: r,
        col: c,
        unitCol: unitCol < 0 ? c + 1 : unitCol,
        qtyCol,
        costCol,
        totalCol: totalCol < 0 ? costCol + 1 : totalCol,
        titleRow,
        title,
      });
    }
  }
  return headers;
}

interface RawLine {
  row: number;
  name: string;
  unit: string | null;
  quantity: number | null;
  costCell: Cell;
  unitCost: number | null;
  lineTotal: number | null;
}

interface RawBlock {
  tab: string;
  header: HeaderAt;
  /** Named groups; a block without section rows has one, named by title. */
  groups: Array<{
    name: string;
    row: number;
    lines: RawLine[];
    sectioned: boolean;
  }>;
  total: { value: number | null; cell: string; formula: string | null } | null;
  perUnit: Array<{ unit: string; value: number | null; cell: string }>;
  sale: number | null;
}

function readBlock(
  ws: XLSX.WorkSheet,
  tab: string,
  header: HeaderAt,
  endRow: number
): RawBlock {
  const title = header.title ?? `Bloque ${addr(header.row, header.col)}`;
  const block: RawBlock = {
    tab,
    header,
    groups: [
      {
        name: title,
        row: header.titleRow ?? header.row,
        lines: [],
        sectioned: false,
      },
    ],
    total: null,
    perUnit: [],
    sale: null,
  };
  let inFooter = false;
  for (let r = header.row + 1; r <= endRow; r++) {
    const name = clean(cellAt(ws, r, header.col).v);
    const label = fold(name);
    if (!name) {
      if (inFooter) break;
      continue;
    }
    if (TOTAL_RE.test(label)) {
      inFooter = true;
      if (!block.total) {
        const cell = cellAt(ws, r, header.totalCol);
        block.total = {
          value: numberOf(cell),
          cell: addr(r, header.totalCol),
          formula: cell.f,
        };
      }
      continue;
    }
    const perUnit = label.match(PER_UNIT_RE);
    if (perUnit) {
      inFooter = true;
      block.perUnit.push({
        unit: perUnit[1],
        value: numberOf(cellAt(ws, r, header.totalCol)),
        cell: addr(r, header.totalCol),
      });
      continue;
    }
    if (SALE_RE.test(label)) {
      inFooter = true;
      block.sale = numberOf(cellAt(ws, r, header.totalCol));
      continue;
    }
    if (MARGIN_RE.test(label)) {
      inFooter = true;
      continue;
    }
    if (inFooter || BANNER_RE.test(label)) break;

    const unitRaw = clean(cellAt(ws, r, header.unitCol).v) || null;
    const qtyCell = cellAt(ws, r, header.qtyCol);
    const costCell = cellAt(ws, r, header.costCol);
    const quantity = numberOf(qtyCell);
    const costValue = numberOf(costCell);
    const hasCost = costValue !== null || isErrorCell(costCell);
    if (!unitRaw && quantity === null && !hasCost) {
      // A label row inside the block ("GUARNIONES FULL"): a new group.
      block.groups.push({ name, row: r, lines: [], sectioned: true });
      continue;
    }
    block.groups[block.groups.length - 1].lines.push({
      row: r,
      name,
      unit: unitRaw,
      quantity,
      costCell,
      unitCost: costValue,
      lineTotal: numberOf(cellAt(ws, r, header.totalCol)),
    });
  }
  return block;
}

/** Size from a dish title: "PARA 3" → 3 personas; trailing "6" → 6 oz. */
export function dishSize(title: string): {
  base: string;
  size: string | null;
  value: number | null;
  kind: "oz" | "personas" | null;
} {
  const text = clean(title);
  const para = text.match(/^(.*?)\s+PARA\s+(\d+)\s*(?:PERSONAS?)?\s*$/i);
  if (para) {
    const n = Number(para[2]);
    return {
      base: para[1].trim(),
      size: `${n} personas`,
      value: n,
      kind: "personas",
    };
  }
  const oz = text.match(
    /^(.*?\D)\s*(\d+(?:[.,]\d+)?)\s*(?:ONZAS?|OZ\.?)?\s*$/i
  );
  if (oz) {
    const n = Number(oz[2].replace(",", "."));
    return { base: oz[1].trim(), size: `${n} oz`, value: n, kind: "oz" };
  }
  return { base: text, size: null, value: null, kind: null };
}

function unitNorm(raw: string | null): { norm: string | null; known: boolean } {
  if (!raw) return { norm: null, known: false };
  const known = normalizeUnit(raw);
  if (known) return { norm: known, known: true };
  const word = fold(raw);
  if (PORTION_UNITS.has(word)) {
    return { norm: word.toLowerCase().replace(/es$|s$/, ""), known: true };
  }
  return { norm: null, known: false };
}

function round(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function addFlag(list: CanonicalFlag[], flag: CanonicalFlag): void {
  if (!list.includes(flag)) list.push(flag);
}

/** Read every recipe block of the workbook into the canonical table. */
export function translateCostWorkbook(wb: XLSX.WorkBook): CanonicalWorkbook {
  const raw: RawBlock[] = [];
  for (const tab of wb.SheetNames) {
    const ws = wb.Sheets[tab];
    if (!ws?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const headers = findHeaders(ws, range);
    headers.forEach((header, i) => {
      const next = headers
        .slice(i + 1)
        .find((h) => h.col === header.col && h.row > header.row);
      const endRow = next ? (next.titleRow ?? next.row) - 1 : range.e.r;
      raw.push(readBlock(ws, tab, header, endRow));
    });
  }

  // One canonical recipe per group.
  const recipes: CanonicalRecipe[] = [];
  const footerToRecipe = new Map<string, string>();
  const usedNames = new Map<string, number>();

  for (const block of raw) {
    const kind: CanonicalKind = PREPARATION_TAB_RE.test(block.tab)
      ? "preparation"
      : "dish";
    const events = EVENTS_TAB_RE.test(block.tab);
    const sectioned = block.groups.some((g) => g.sectioned);
    for (const group of block.groups) {
      if (group.lines.length === 0 && (sectioned || group.sectioned)) continue;
      const key = `${block.tab}!${addr(group.row, block.header.col)}`;
      const flags: CanonicalFlag[] = [];
      const title = group.name
        .replace(/\s*\$\s*\d+(?:[.,]\d+)?\s*$/, "")
        .trim();
      const sized =
        kind === "dish"
          ? dishSize(title)
          : { base: title, size: null, value: null, kind: null };
      let name = title;
      if (events) {
        addFlag(flags, "menu_eventos");
        name = `${title} (EVENTOS)`;
      }
      const nameKey = `${kind}:${fold(name)}`;
      const seen = usedNames.get(nameKey) ?? 0;
      usedNames.set(nameKey, seen + 1);
      if (seen > 0) {
        addFlag(flags, "nombre_repetido");
        name = `${name} (${seen + 1})`;
      }

      const ownsFooter = !group.sectioned && block.groups.indexOf(group) === 0;
      const total = ownsFooter ? block.total : null;
      const range = total ? sumRowRange(total.formula) : null;

      const lines: CanonicalLine[] = group.lines.map((line) => {
        const lineFlags: CanonicalFlag[] = [];
        const unit = unitNorm(line.unit);
        if (!unit.known) addFlag(lineFlags, "unidad_no_reconocida");
        if (line.quantity === null || line.quantity === 0) {
          addFlag(lineFlags, "cantidad_cero");
        }
        const unitCost =
          line.unitCost !== null && line.unitCost > 0 ? line.unitCost : null;
        if (unitCost === null) addFlag(lineFlags, "costo_pendiente");
        if (range && (line.row + 1 < range.from || line.row + 1 > range.to)) {
          addFlag(lineFlags, "fuera_del_total_excel");
        }
        if (
          unitCost !== null &&
          line.quantity !== null &&
          line.lineTotal !== null &&
          Math.abs(line.quantity * unitCost - line.lineTotal) > 0.005
        ) {
          addFlag(lineFlags, "total_linea_no_cuadra");
        }
        return {
          dish_name: kind === "dish" ? sized.base : name,
          size: sized.size,
          ingredient_name: line.name,
          unit: line.unit,
          unit_norm: unit.norm,
          quantity: line.quantity,
          unit_cost: unitCost,
          line_total: line.lineTotal,
          excel_total_cost: total?.value ?? null,
          excel_price_sin_iva: ownsFooter ? block.sale : null,
          source_tab: block.tab,
          source_cell: addr(line.row, block.header.col),
          flags: lineFlags,
          preparation_key: null,
          // Kept for the reference pass below.
          ...({ __costFormula: line.costCell.f } as object),
        } as CanonicalLine;
      });

      const calculated = lines.reduce(
        (sum, line) =>
          line.unit_cost !== null && line.quantity
            ? sum + line.quantity * line.unit_cost
            : sum,
        0
      );
      const pending = lines.filter((line) => line.unit_cost === null).length;
      if (pending > 0) addFlag(flags, "lineas_pendientes");
      const excelTotal = total?.value ?? null;
      if (excelTotal === null) {
        addFlag(flags, "sin_total_excel");
        addFlag(flags, "excel_no_cuadra");
      } else if (Math.abs(calculated - excelTotal) > EXCEL_MATCH_TOLERANCE) {
        addFlag(flags, "excel_no_cuadra");
      }

      let output: CanonicalRecipe["output"] = null;
      if (kind === "preparation") {
        if (group.sectioned) {
          // The file averages these options: one "orden" is one of them.
          addFlag(flags, "promedio_de_opciones");
          output = { quantity: Math.max(1, lines.length), unit: "orden" };
        } else {
          const per = ownsFooter
            ? block.perUnit.find((p) => p.value !== null && p.value > 0)
            : undefined;
          const perUnit = per ? normalizeUnit(per.unit) : null;
          const base = excelTotal ?? calculated;
          if (per && perUnit && base > 0) {
            output = { quantity: round(base / per.value!, 4), unit: perUnit };
          } else {
            addFlag(flags, "rendimiento_supuesto");
            output = { quantity: 1, unit: "orden" };
          }
        }
        // A line elsewhere that points at this total (or its per-unit
        // price) is using this preparation.
        if (ownsFooter) {
          if (block.total)
            footerToRecipe.set(`${block.tab}!${block.total.cell}`, key);
          for (const per of block.perUnit) {
            footerToRecipe.set(`${block.tab}!${per.cell}`, key);
          }
        }
      }

      recipes.push({
        key,
        kind,
        name,
        dish_name: kind === "dish" ? sized.base : name,
        size: sized.size,
        size_value: sized.value,
        size_kind: sized.kind,
        source_tab: block.tab,
        source_cell: addr(group.row, block.header.col),
        excel_total_cost: excelTotal,
        excel_total_cell: total ? total.cell : null,
        excel_price_sin_iva: ownsFooter ? block.sale : null,
        output,
        lines,
        calculated_cost: round(calculated, 6),
        pending_lines: pending,
        flags,
      });
    }
  }

  // Which preparation a line uses: its cost points straight at a
  // preparation's total, or its name is exactly one preparation's name.
  const prepsByName = new Map<string, string[]>();
  for (const recipe of recipes) {
    if (recipe.kind !== "preparation") continue;
    const k = normalizeMatchName(recipe.name.replace(/\s*\(\d+\)$/, ""));
    prepsByName.set(k, [...(prepsByName.get(k) ?? []), recipe.key]);
  }
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      const formula = (line as unknown as { __costFormula: string | null })
        .__costFormula;
      delete (line as unknown as { __costFormula?: unknown }).__costFormula;
      const ref = singleRef(formula, line.source_tab);
      const byFormula = ref
        ? footerToRecipe.get(`${ref.sheet}!${ref.cell}`)
        : undefined;
      const byName = prepsByName.get(normalizeMatchName(line.ingredient_name));
      const target =
        byFormula ?? (byName && byName.length === 1 ? byName[0] : undefined);
      if (target && target !== recipe.key) line.preparation_key = target;
    }
  }

  // Across the file: the same ingredient with other costs or other units.
  const byNameUnit = new Map<string, CanonicalLine[]>();
  const dishLinesByName = new Map<string, CanonicalLine[]>();
  for (const recipe of recipes) {
    for (const line of recipe.lines) {
      const nameKey = normalizeMatchName(line.ingredient_name);
      const unitKey = `${nameKey}|${line.unit_norm ?? fold(line.unit)}`;
      byNameUnit.set(unitKey, [...(byNameUnit.get(unitKey) ?? []), line]);
      if (recipe.kind === "dish") {
        dishLinesByName.set(nameKey, [
          ...(dishLinesByName.get(nameKey) ?? []),
          line,
        ]);
      }
    }
  }
  for (const lines of byNameUnit.values()) {
    const costs = lines
      .map((line) => line.unit_cost)
      .filter((cost): cost is number => cost !== null);
    if (costs.length < 2) continue;
    // Costs within 1% are the same price written with more decimals.
    if (Math.max(...costs) / Math.min(...costs) <= 1 + COST_SAME_SHARE)
      continue;
    for (const line of lines) addFlag(line.flags, "costo_distinto");
  }
  // A dish line in another unit than most dishes use for that ingredient
  // (a steak priced by LIBRA when every other dish uses that cut by ONZA).
  for (const lines of dishLinesByName.values()) {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const unitKey = line.unit_norm ?? fold(line.unit);
      counts.set(unitKey, (counts.get(unitKey) ?? 0) + 1);
    }
    if (counts.size < 2) continue;
    const top = Math.max(...counts.values());
    const leaders = [...counts.values()].filter((n) => n === top).length;
    for (const line of lines) {
      const unitKey = line.unit_norm ?? fold(line.unit);
      if (leaders > 1 || counts.get(unitKey)! < top) {
        addFlag(line.flags, "unidad_distinta");
      }
    }
  }

  const tabs = new Map<string, { dishes: number; preparations: number }>();
  for (const recipe of recipes) {
    const row = tabs.get(recipe.source_tab) ?? { dishes: 0, preparations: 0 };
    if (recipe.kind === "dish") row.dishes += 1;
    else row.preparations += 1;
    tabs.set(recipe.source_tab, row);
  }
  return {
    recipes,
    tabs: [...tabs.entries()].map(([name, row]) => ({
      name: name.trim(),
      ...row,
    })),
  };
}

export function translateCostWorkbookBuffer(buffer: Buffer): CanonicalWorkbook {
  return translateCostWorkbook(
    XLSX.read(buffer, { type: "buffer", cellFormula: true, cellDates: false })
  );
}
