// lib/restaurant/fixed-cost-upload.ts
//
// #409 · Costos fijos: the lines of an uploaded file (Excel/CSV, PDF, photo).
// Pure, no I/O. A file is read into DRAFT lines; nothing reaches
// restaurant_fixed_costs until a person approves. A line the reader could not
// fully understand is KEPT with a flag (never dropped, never set to $0); an
// amount that is missing, unreadable or ≤ 0 is «Sin precio».

import {
  isFixedCostCategory,
  lineKey,
  monthStartOf,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";

export type DraftScope =
  | { kind: "restaurant"; locationId: string }
  | { kind: "group" };

export type LineIssue = "category" | "amount" | "restaurant" | "month";

export interface DraftLine {
  id: string;
  /** What the file said (concept + restaurant), shown next to the line. */
  raw: string;
  category: FixedCostCategory | null;
  /** An amount, or the tax rate in % for impuestos; null = «Sin precio». */
  amount: number | null;
  /** `YYYY-MM-01`; null = not understood. */
  month: string | null;
  /** null = the restaurant named in the file is not one of yours. */
  scope: DraftScope | null;
  /** «ai» lines come from reading a PDF or photo: lavender tag. */
  from: "file" | "ai";
  status: "pending" | "approved" | "discarded";
}

export interface KnownLocation {
  id: string;
  name: string;
}

export interface ReadDefaults {
  month: string;
  scope: DraftScope;
  locations: readonly KnownLocation[];
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/**
 * A money (or %) cell → a number above 0, else null («Sin precio»). Reads
 * "$1,200.50", "1.200,50", "1 200", 850. Zero, negatives and text are null.
 */
export function parseAmount(cell: unknown): number | null {
  if (typeof cell === "number")
    return Number.isFinite(cell) && cell > 0 ? cell : null;
  if (typeof cell !== "string") return null;
  let t = cell.replace(/[\s\u00a0\u202f$€£%]|USD|MXN|EUR/gi, "");
  if (!t || /^\(.*\)$/.test(t) || t.startsWith("-")) return null;
  if (!/^[0-9.,]+$/.test(t)) return null;
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    t = t.split(thou).join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = t.split(sep);
    const tail = parts[parts.length - 1];
    // "0.750" is 0.75, never 750: a leading 0 cannot head a thousands group.
    const thousands =
      parts.length > 2 ||
      (tail.length === 3 && parts[0].length <= 3 && parts[0] !== "0");
    t = thousands ? parts.join("") : parts.join(".");
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const CATEGORY_WORDS: Array<[FixedCostCategory, RegExp]> = [
  [
    "planilla",
    /planilla|nomina|sueldo|salari|payroll|wages|lohn|gehalt|personal\b|staff/,
  ],
  ["alquiler", /alquiler|renta\b|arrend|\brent\b|lease|miete|pacht/],
  [
    "servicios",
    /servicio|luz\b|electric|agua\b|water|\bgas\b|internet|telefon|phone|utilit|strom|wasser|energi/,
  ],
  ["impuestos", /impuesto|\biva\b|\bitbms\b|tax\b|steuer|isr\b/],
  ["otros", /\botros?\b|other|misc|varios|sonstig/],
];

/** The category a concept names, or null (unrecognized: shown with ⚑). */
export function detectCategory(text: string): FixedCostCategory | null {
  const t = fold(text);
  if (!t) return null;
  for (const [cat, re] of CATEGORY_WORDS) if (re.test(t)) return cat;
  return null;
}

const MONTH_NAMES: Record<string, number> = {
  enero: 1,
  january: 1,
  januar: 1,
  jan: 1,
  ene: 1,
  febrero: 2,
  february: 2,
  februar: 2,
  feb: 2,
  marzo: 3,
  march: 3,
  maerz: 3,
  mar: 3,
  abril: 4,
  april: 4,
  apr: 4,
  abr: 4,
  mayo: 5,
  may: 5,
  mai: 5,
  junio: 6,
  june: 6,
  juni: 6,
  jun: 6,
  julio: 7,
  july: 7,
  juli: 7,
  jul: 7,
  agosto: 8,
  august: 8,
  ago: 8,
  aug: 8,
  septiembre: 9,
  setiembre: 9,
  september: 9,
  sep: 9,
  sept: 9,
  octubre: 10,
  october: 10,
  oktober: 10,
  oct: 10,
  okt: 10,
  noviembre: 11,
  november: 11,
  nov: 11,
  diciembre: 12,
  december: 12,
  dezember: 12,
  dic: 12,
  dec: 12,
  dez: 12,
};

/** A month cell → `YYYY-MM-01` or null. Reads 2026-10, 10/2026, «octubre 2026», dates. */
export function parseMonthCell(cell: unknown): string | null {
  if (cell instanceof Date && !Number.isNaN(cell.getTime()))
    return monthStartOf(cell);
  if (typeof cell !== "string") return null;
  const t = fold(cell);
  let m = t.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return ymd(Number(m[1]), Number(m[2]));
  m = t.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return ymd(Number(m[2]), Number(m[1]));
  m = t.match(/^([a-z]+)[\s.-]*(?:de\s+)?(\d{4})$/);
  if (m && MONTH_NAMES[m[1]]) return ymd(Number(m[2]), MONTH_NAMES[m[1]]);
  return null;
}

function ymd(y: number, m: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12)) return null;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

const GROUP_WORDS =
  /^(grupo|group|gruppe|todos|all|compartido|shared|general)\b/;

const MIN_PARTIAL_SCOPE = 4;

export function scopeFromText(
  text: string,
  locations: readonly KnownLocation[]
): DraftScope | null {
  const t = fold(text);
  if (GROUP_WORDS.test(t)) return { kind: "group" };
  if (!t) return null;
  // An exact name wins. Otherwise a partial match counts only when it is
  // unambiguous (exactly one restaurant) and the text is long enough to mean
  // something; «Los Ranchos» between two «Los Ranchos …» is null (⚑ Falta).
  const exact = locations.filter((l) => fold(l.name) === t);
  if (exact.length === 1)
    return { kind: "restaurant", locationId: exact[0].id };
  if (exact.length > 1 || t.length < MIN_PARTIAL_SCOPE) return null;
  const partial = locations.filter((l) => {
    const n = fold(l.name);
    return n && (n.includes(t) || t.includes(n));
  });
  return partial.length === 1
    ? { kind: "restaurant", locationId: partial[0].id }
    : null;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** What is wrong with a line; empty = ready to approve. */
export function issuesOf(line: DraftLine): LineIssue[] {
  const out: LineIssue[] = [];
  if (!line.category) out.push("category");
  const max = line.category === "impuestos" ? 100 : Infinity;
  if (line.amount === null || !(line.amount > 0) || line.amount > max)
    out.push("amount");
  if (!line.month) out.push("month");
  if (!line.scope) out.push("restaurant");
  return out;
}

export const isApprovable = (line: DraftLine) =>
  line.status === "pending" && issuesOf(line).length === 0;

const CONCEPT_H =
  /concepto|categoria|rubro|descripcion|detalle|item|concept|category|description|name|nombre|kategorie|beschreibung/;
const AMOUNT_H =
  /monto|importe|amount|total|valor|value|costo|cost|precio|price|betrag|kosten/;
const MONTH_H = /^(mes|month|periodo|period|fecha|date|monat)\b/;
const PLACE_H =
  /restaurante|restaurant|sucursal|local\b|location|site|standort/;

interface Cols {
  concept: number;
  amount: number;
  month: number;
  place: number;
  first: number;
}

function findHeader(grid: readonly unknown[][]): Cols | null {
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r].map((c) => fold(String(c ?? "")));
    const concept = row.findIndex((c) => c && CONCEPT_H.test(c));
    const amount = row.findIndex(
      (c, i) => i !== concept && c && AMOUNT_H.test(c)
    );
    if (concept >= 0 && amount >= 0)
      return {
        concept,
        amount,
        month: row.findIndex((c) => c && MONTH_H.test(c)),
        place: row.findIndex((c) => c && PLACE_H.test(c)),
        first: r + 1,
      };
  }
  return null;
}

/** Reads a sheet or CSV (rows of cells) into draft lines. Never drops a line. */
export function parseGrid(
  grid: readonly unknown[][],
  defaults: ReadDefaults
): DraftLine[] {
  const cols = findHeader(grid) ?? {
    concept: 0,
    amount: 1,
    month: -1,
    place: -1,
    first: 0,
  };
  const out: DraftLine[] = [];
  for (let r = cols.first; r < grid.length; r++) {
    const row = grid[r];
    const concept = String(row[cols.concept] ?? "").trim();
    const rawAmount = row[cols.amount];
    const emptyAmount =
      rawAmount === undefined ||
      rawAmount === null ||
      String(rawAmount).trim() === "";
    if (!concept && emptyAmount) continue;
    const place = cols.place >= 0 ? String(row[cols.place] ?? "").trim() : "";
    const monthCell = cols.month >= 0 ? row[cols.month] : undefined;
    const hasMonth =
      monthCell !== undefined &&
      monthCell !== null &&
      String(monthCell).trim() !== "";
    out.push({
      id: `l${out.length + 1}`,
      raw: [concept, place].filter(Boolean).join(" · ").slice(0, 160),
      category: detectCategory(concept),
      amount: parseAmount(rawAmount),
      month: hasMonth ? parseMonthCell(monthCell) : defaults.month,
      scope: place ? scopeFromText(place, defaults.locations) : defaults.scope,
      from: "file",
      status: "pending",
    });
  }
  return out;
}

const MAX_AI_LINES = 60;

/** Validates what the AI read from a PDF or photo; every line is a draft. */
export function normalizeAiLines(
  raw: unknown,
  defaults: ReadDefaults
): DraftLine[] {
  const list =
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as { lines?: unknown }).lines)
      ? ((raw as { lines: unknown[] }).lines as unknown[])
      : [];
  const out: DraftLine[] = [];
  for (const row of list.slice(0, MAX_AI_LINES)) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const label =
      typeof r.label === "string" ? r.label.trim().slice(0, 120) : "";
    const place = typeof r.restaurant === "string" ? r.restaurant.trim() : "";
    if (!label && r.amount == null) continue;
    const category = isFixedCostCategory(r.category)
      ? r.category
      : detectCategory(label);
    const month =
      r.month == null || r.month === ""
        ? defaults.month
        : parseMonthCell(String(r.month));
    out.push({
      id: `l${out.length + 1}`,
      raw: [label, place].filter(Boolean).join(" · ").slice(0, 160),
      category,
      amount: parseAmount(r.amount),
      month,
      scope: place ? scopeFromText(place, defaults.locations) : defaults.scope,
      from: "ai",
      status: "pending",
    });
  }
  return out;
}

export const FIXED_COST_AI_PROMPT =
  "You read a restaurant's monthly fixed costs (a PDF's text or a photo of a statement) in Spanish, English or German. " +
  'Answer ONLY JSON: {"lines":[{"label":string,"category":"planilla"|"alquiler"|"servicios"|"otros"|"impuestos"|null,"amount":number|null,"month":"YYYY-MM"|null,"restaurant":string|null}]}. ' +
  "label is the concept as written. amount is the number printed (for impuestos the tax rate in %); null when unreadable, never invent one. month only when the document states it. restaurant only when it names one. Keep every line, even ones you cannot classify (category null).";

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface ExistingValue {
  amount: number | null;
  pct_of_sales: number | null;
}

export interface ApprovalWrite {
  /**
   * What is saved: the first line of the group with the SUMMED amount and the
   * parts joined in `raw`. A lone line is itself.
   */
  line: DraftLine;
  /** Every draft line that this one row stands for (all approved together). */
  members: DraftLine[];
  /** The row's current value, when the month already has one. */
  previous: ExistingValue | null;
}

export interface OverwriteConflict {
  /** The first line of the group: confirming it confirms the whole group. */
  lineId: string;
  category: FixedCostCategory;
  month: string;
  scope: DraftScope;
  old: number;
  new: number;
}

const valueOfExisting = (
  e: ExistingValue,
  category: FixedCostCategory
): number | null => (category === "impuestos" ? e.pct_of_sales : e.amount);

export const keyOfLine = (l: DraftLine): string =>
  lineKey({
    location_id: l.scope?.kind === "restaurant" ? l.scope.locationId : null,
    month: l.month as string,
    category: l.category as FixedCostCategory,
  });

const LABEL_MAX = 120;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Pending impuestos lines that share a category/month/scope with another one.
 * A rate (%) is not additive, so these are never summed: they stay ⚑ Falta
 * until the person keeps one.
 */
export function duplicateTaxIds(lines: readonly DraftLine[]): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const l of lines) {
    if (l.category !== "impuestos" || !isApprovable(l)) continue;
    const k = keyOfLine(l);
    byKey.set(k, [...(byKey.get(k) ?? []), l.id]);
  }
  const out = new Set<string>();
  for (const ids of byKey.values())
    if (ids.length > 1) ids.forEach((i) => out.add(i));
  return out;
}

export interface CategoryTotal {
  key: string;
  category: FixedCostCategory;
  month: string;
  scope: DraftScope;
  lines: number;
  total: number;
}

/** Per category/month/scope, how many ready lines and their sum (not for impuestos). */
export function categoryTotals(lines: readonly DraftLine[]): CategoryTotal[] {
  const dup = duplicateTaxIds(lines);
  const by = new Map<string, CategoryTotal>();
  for (const l of lines) {
    if (!isApprovable(l) || dup.has(l.id) || l.category === "impuestos")
      continue;
    const key = keyOfLine(l);
    const g = by.get(key);
    if (g) {
      g.lines += 1;
      g.total = round2(g.total + (l.amount as number));
    } else
      by.set(key, {
        key,
        category: l.category as FixedCostCategory,
        month: l.month as string,
        scope: l.scope as DraftScope,
        lines: 1,
        total: l.amount as number,
      });
  }
  return [...by.values()];
}

/**
 * What approving `selected` would do. Lines of one category/month/scope are
 * ONE row (restaurant_fixed_costs allows one per key): their amounts are
 * summed and their labels joined with « + ». Two impuestos lines of the same
 * key are not summed: they are blocked. A value already in the month is never
 * overwritten silently: a different one (compared with the sum) is a conflict
 * (old → new) that needs a confirmation; an identical one changes nothing.
 * Lines with issues are left alone.
 */
export function planApproval(
  selected: readonly DraftLine[],
  existing: ReadonlyMap<string, ExistingValue>
): {
  writes: ApprovalWrite[];
  conflicts: OverwriteConflict[];
  unchanged: DraftLine[];
  blocked: DraftLine[];
} {
  const writes: ApprovalWrite[] = [];
  const conflicts: OverwriteConflict[] = [];
  const unchanged: DraftLine[] = [];
  const blocked: DraftLine[] = [];
  const dupTax = duplicateTaxIds(selected);
  const groups = new Map<string, DraftLine[]>();
  for (const line of selected) {
    if (!isApprovable(line) || dupTax.has(line.id)) {
      blocked.push(line);
      continue;
    }
    const key = keyOfLine(line);
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  for (const [key, members] of groups) {
    const first = members[0];
    const category = first.category as FixedCostCategory;
    const amount = round2(
      members.reduce((sum, l) => sum + (l.amount as number), 0)
    );
    const line: DraftLine =
      members.length === 1
        ? first
        : {
            ...first,
            amount,
            raw: members
              .map((l) => l.raw)
              .filter(Boolean)
              .join(" + ")
              .slice(0, LABEL_MAX),
          };
    const prev = existing.get(key) ?? null;
    const old = prev ? valueOfExisting(prev, category) : null;
    if (prev && old !== null && old === amount) {
      unchanged.push(...members);
      continue;
    }
    if (prev && old !== null)
      conflicts.push({
        lineId: first.id,
        category,
        month: first.month as string,
        scope: first.scope as DraftScope,
        old,
        new: amount,
      });
    writes.push({ line, members, previous: prev });
  }
  return { writes, conflicts, unchanged, blocked };
}
