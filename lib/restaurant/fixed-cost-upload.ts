// lib/restaurant/fixed-cost-upload.ts
//
// #409 · Costos fijos: the lines of an uploaded file (Excel/CSV, PDF, photo).
// Pure, no I/O. A file is read into DRAFT lines; nothing reaches
// restaurant_fixed_costs until a person approves. A line the reader could not
// fully understand is KEPT with a flag (never dropped, never set to $0); an
// amount that is missing, unreadable or ≤ 0 is «Sin precio».

import {
  FIXED_COST_CATEGORIES,
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
  /** A one-off charge (repair, deposit…): «Se repite cada mes» defaults OFF for it. */
  oneTime?: boolean;
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

/**
 * Concepts that are paid once, not every month: «Se repite cada mes» starts OFF
 * for them (a repair, a deposit, an installation, a fine).
 */
const ONE_TIME =
  /reparaci|repair|reparatur|dep[oó]sito|deposit|kaution|fianza|instalaci|installation|einmalig|one[- ]?time|[uú]nica vez|extraordinari|multa|\bfine\b|\bstrafe\b/;
export function isOneTimeText(text: string): boolean {
  return ONE_TIME.test(fold(text));
}

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
  // something; «La Esquina» between two «La Esquina …» is null (⚑ Falta).
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
      ...(isOneTimeText(concept) ? { oneTime: true } : {}),
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
      ...(r.oneTime === true || isOneTimeText(label) ? { oneTime: true } : {}),
    });
  }
  return out;
}

export const FIXED_COST_AI_PROMPT =
  "You read a restaurant's monthly fixed costs (a PDF's text or a photo of a statement) in Spanish, English or German. " +
  'Answer ONLY JSON: {"lines":[{"label":string,"category":"planilla"|"alquiler"|"servicios"|"otros"|"impuestos"|null,"amount":number|null,"month":"YYYY-MM"|null,"restaurant":string|null,"oneTime":boolean}]}. ' +
  "label is the concept as written. amount is the number printed (for impuestos the tax rate in %); null when unreadable, never invent one. month only when the document states it. restaurant only when it names one. oneTime is true only for a charge paid once (a repair, a deposit, an installation, a fine), false for a regular monthly bill. Keep every line, even ones you cannot classify (category null).";

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

export interface ExistingValue {
  amount: number | null;
  pct_of_sales: number | null;
  /** Where the saved value came from ('upload', 'manual', …), when known. */
  source?: string | null;
  label?: string | null;
  /** «Se repite cada mes» of the saved row. */
  repeats?: boolean | null;
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
  /** The lines add to the saved value (this upload's own, or «Sumar»). */
  adds: boolean;
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
 *
 * One at a time: when the saved value is exactly what THIS upload already
 * approved for the key (`approved` = the draft's approved lines, saved with
 * source 'upload'), approving more lines of that key ADDS to it (Luz 1,800 +
 * Agua 650 = 2,450, label «Luz + Agua»), without a warning. A value from
 * anywhere else (typed by hand, an earlier file, edited since) is still a
 * conflict. A rate (impuestos) is never added up.
 */
export function planApproval(
  selected: readonly DraftLine[],
  existing: ReadonlyMap<string, ExistingValue>,
  approved: readonly DraftLine[] = [],
  /**
   * Keys (see keyOfLine) where the person chose «Sumar»: the lines ADD to the
   * saved value whatever its source. Never for a rate.
   */
  addKeys: ReadonlySet<string> = new Set()
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
  const before = new Map<string, DraftLine[]>();
  for (const l of approved) {
    if (l.status !== "approved" || !isApprovable({ ...l, status: "pending" }))
      continue;
    before.set(keyOfLine(l), [...(before.get(keyOfLine(l)) ?? []), l]);
  }
  for (const [key, members] of groups) {
    const first = members[0];
    const category = first.category as FixedCostCategory;
    const prev = existing.get(key) ?? null;
    const old = prev ? valueOfExisting(prev, category) : null;
    // The saved value is this upload's own earlier approvals: add to it.
    const mine = before.get(key) ?? [];
    const mineSum = round2(
      mine.reduce((sum, l) => sum + (l.amount as number), 0)
    );
    const ownAdds =
      category !== "impuestos" &&
      prev?.source === "upload" &&
      old !== null &&
      mine.length > 0 &&
      old === mineSum;
    // «Sumar» on a value from elsewhere: its label stays as the first part.
    const chosenAdds =
      !ownAdds && category !== "impuestos" && old !== null && addKeys.has(key);
    const adds = ownAdds || chosenAdds;
    const parts = ownAdds ? [...mine, ...members] : members;
    const amount = round2(
      parts.reduce((sum, l) => sum + (l.amount as number), 0) +
        (chosenAdds ? (old as number) : 0)
    );
    const names = [
      ...(chosenAdds && prev?.label ? [prev.label] : []),
      ...parts.map((l) => l.raw),
    ].filter(Boolean);
    const line: DraftLine =
      parts.length === 1 && !chosenAdds
        ? first
        : {
            ...first,
            amount,
            raw: names.join(" + ").slice(0, LABEL_MAX),
          };
    if (prev && old !== null && old === amount) {
      unchanged.push(...members);
      continue;
    }
    if (prev && old !== null && !adds)
      conflicts.push({
        lineId: first.id,
        category,
        month: first.month as string,
        scope: first.scope as DraftScope,
        old,
        new: amount,
      });
    writes.push({ line, members, previous: prev, adds });
  }
  return { writes, conflicts, unchanged, blocked };
}

// ---------------------------------------------------------------------------
// Inline review (no modal, no reload): what the list shows
// ---------------------------------------------------------------------------

export interface ClusterReview {
  category: FixedCostCategory;
  pending: DraftLine[];
  approved: DraftLine[];
  /** Sum of the approved lines (not for impuestos: a rate is never added). */
  approvedTotal: number;
  /** Sum of the ready pending lines. */
  pendingTotal: number;
}

export interface InlineReview {
  /** ⚑ Falta lines (no category, no amount, or a duplicate rate): at the top until fixed. */
  fix: DraftLine[];
  clusters: ClusterReview[];
}

/** Lines grouped by cluster, flagged ones apart; clusters in the usual order. */
export function inlineReview(lines: readonly DraftLine[]): InlineReview {
  const dup = duplicateTaxIds(lines);
  const fix: DraftLine[] = [];
  const by = new Map<FixedCostCategory, ClusterReview>();
  const slot = (c: FixedCostCategory) => {
    let g = by.get(c);
    if (!g) {
      g = {
        category: c,
        pending: [],
        approved: [],
        approvedTotal: 0,
        pendingTotal: 0,
      };
      by.set(c, g);
    }
    return g;
  };
  for (const l of lines) {
    if (l.status === "discarded") continue;
    if (l.status === "approved") {
      if (!l.category) continue;
      const g = slot(l.category);
      g.approved.push(l);
      if (l.category !== "impuestos")
        g.approvedTotal = round2(g.approvedTotal + (l.amount ?? 0));
      continue;
    }
    if (!isApprovable(l) || dup.has(l.id) || !l.category) {
      fix.push(l);
      continue;
    }
    const g = slot(l.category);
    g.pending.push(l);
    if (l.category !== "impuestos")
      g.pendingTotal = round2(g.pendingTotal + (l.amount as number));
  }
  return {
    fix,
    clusters: FIXED_COST_CATEGORIES.flatMap((c) => {
      const g = by.get(c);
      return g ? [g] : [];
    }),
  };
}

/** «Aprobar todo (n · $X)»: only ready lines; ⚑ Falta lines are skipped. */
export function bulkApprovable(lines: readonly DraftLine[]): {
  ids: string[];
  count: number;
  total: number;
} {
  const dup = duplicateTaxIds(lines);
  const ready = lines.filter((l) => isApprovable(l) && !dup.has(l.id));
  return {
    ids: ready.map((l) => l.id),
    count: ready.length,
    total: round2(
      ready.reduce(
        (sum, l) => sum + (l.category === "impuestos" ? 0 : (l.amount ?? 0)),
        0
      )
    ),
  };
}

/** The change vs last month as a fraction (0.34 = +34%), only when it is above 20%. */
export function changeVsLastMonth(
  total: number,
  last: number | undefined
): number | null {
  if (last === undefined || last === 0) return null;
  const change = (total - last) / last;
  return Math.abs(change) > 0.2 ? change : null;
}

/** What a cluster is worth after approving `adding` on top of `current`. */
export function clusterTotalAfter(
  category: FixedCostCategory,
  current: number | null,
  adding: readonly DraftLine[]
): number {
  const sum = round2(adding.reduce((s, l) => s + (l.amount ?? 0), 0));
  if (category === "impuestos") return adding[adding.length - 1]?.amount ?? 0;
  return round2((current ?? 0) + sum);
}

/**
 * «Se repite cada mes» for a row an approval writes: ON for ordinary monthly
 * bills, OFF when any line is a one-off. Adding to a saved row keeps the
 * person's choice for it (OFF stays OFF) and a one-off line turns it OFF.
 */
export function nextRepeats(
  lines: readonly Pick<DraftLine, "oneTime">[],
  adding: boolean,
  priorRepeats: boolean | null | undefined
): boolean {
  const recurring = lines.every((l) => !l.oneTime);
  return adding ? recurring && priorRepeats === true : recurring;
}
