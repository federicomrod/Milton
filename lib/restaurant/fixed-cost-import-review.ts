// lib/restaurant/fixed-cost-import-review.ts
//
// ONE import review. Pure: turns the draft + the database's own preview
// (`previewUpload`, a read) into a single changeset grouped by destination
// month. Nothing here decides money: before/after come from the preview the
// database computed; this file only arranges them and builds the ONE request
// that applies them. The database still validates every expected version and
// commits all of it, or none.

import type {
  PreviewKey,
  UploadPreview,
} from "@/lib/restaurant/fixed-cost-commands";
import type { DraftLine } from "@/lib/restaurant/fixed-cost-upload";
import {
  AMOUNT_CATEGORIES,
  type AmountCategory,
  type FixedCostCategory,
} from "@/lib/restaurant/fixed-costs";

export type OverlapChoice = "replace" | "add";

/** The categories a person can assign an unclear line to. */
export const ASSIGNABLE = [
  "planilla",
  "alquiler",
  "servicios",
  "otros",
] as const satisfies readonly AmountCategory[];
export type AssignableCategory = (typeof ASSIGNABLE)[number];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const SERVICE_WORDS =
  /seguro|insurance|versicherung|luz|electric|agua|water|wasser|gas\b|internet|telefon|phone|strom|heizung|basura|garbage|mull|alarma|alarm/;
const RENT_WORDS = /renta|alquiler|arriendo|rent\b|miete|lease/;
const PAYROLL_WORDS =
  /planilla|sueldo|salario|nomina|payroll|salary|wage|lohn|gehalt/;

/**
 * A reasonable first guess for an unclear line: insurance and utilities →
 * Servicios, anything we cannot place → Otros. It is only a suggestion; the
 * person confirms it with one click.
 */
export function suggestCategory(raw: string): AssignableCategory {
  const t = fold(raw.split(" · ")[0] ?? raw);
  if (PAYROLL_WORDS.test(t)) return "planilla";
  if (RENT_WORDS.test(t)) return "alquiler";
  if (SERVICE_WORDS.test(t)) return "servicios";
  return "otros";
}

/**
 * A file that carries three or more of the four monthly categories for a
 * month reads as a full monthly statement: «use the file's amount» is then the
 * recommended answer to an overlap (still never pre-selected).
 */
export function isFullStatement(group: ReviewGroup): boolean {
  return group.rows.filter((r) => r.category !== "impuestos").length >= 3;
}

export interface ReviewRow {
  key: string;
  category: FixedCostCategory;
  kind: PreviewKey["kind"];
  /** Money (or a % for impuestos), not cents. null = nothing recorded before. */
  before: number | null;
  /** What it becomes by default; null while an overlap still needs a choice. */
  after: number | null;
  afterIfReplace: number;
  afterIfAdd: number;
  /** An overlap with something already recorded: the person must choose, inline. */
  needsChoice: boolean;
  lineIds: string[];
  existing: PreviewKey["existing_items"];
  incomingLines: PreviewKey["lines"];
  /** Whether the existing detail is only a total (no invented breakdown). */
  detail: PreviewKey["detail_state"];
}

export interface ReviewGroup {
  month: string;
  /** null = the group's shared costs. */
  loc: string | null;
  rows: ReviewRow[];
}

export interface UnresolvedLine {
  id: string;
  raw: string;
  /** What the file said for the amount; null = «Sin precio». */
  amount: number | null;
  /** The person can fix these two inline; anything else can only be excluded. */
  missingCategory: boolean;
  missingRestaurant: boolean;
  /**
   * Why the person cannot fix it here (no amount, no month, a repeated tax
   * rate). null = the category and/or restaurant pickers can resolve it.
   */
  blocker: "amount" | "month" | "duplicate_tax" | "other" | null;
  /** A reasonable guess for the category; NEVER applied without one click. */
  suggested: AssignableCategory | null;
  reason:
    | "category"
    | "amount"
    | "month"
    | "restaurant"
    | "duplicate_tax"
    | "other";
}

export interface Review {
  fileName: string | null;
  sameFileSeenBefore: boolean;
  /** Oldest month first. */
  groups: ReviewGroup[];
  unresolved: UnresolvedLine[];
}

const money = (cents: number | null) => (cents === null ? null : cents / 100);

function rowOf(k: PreviewKey): ReviewRow {
  const isRate = k.category === "impuestos";
  const before = k.old_cents === null ? null : (money(k.old_cents) as number);
  const afterIfReplace = k.incoming_cents / 100;
  const afterIfAdd = isRate ? afterIfReplace : k.add_total_cents / 100;
  const needsChoice = k.kind === "overlap";
  const after =
    k.kind === "noop"
      ? before
      : k.kind === "new"
        ? afterIfReplace
        : k.kind === "continue"
          ? afterIfAdd
          : null;
  return {
    key: k.key,
    category: k.category,
    kind: k.kind,
    before,
    after,
    afterIfReplace,
    afterIfAdd,
    needsChoice,
    lineIds: k.lines.map((l) => l.id),
    existing: k.existing_items,
    incomingLines: k.lines,
    detail: k.detail_state,
  };
}

export function buildReview(
  lines: readonly DraftLine[],
  preview: UploadPreview | null
): Review {
  const keys = preview?.keys ?? [];
  const inKey = new Set(keys.flatMap((k) => k.lines.map((l) => l.id)));
  const groups = new Map<string, ReviewGroup>();
  for (const k of keys) {
    if (k.kind === "invalid_duplicate_tax") continue;
    const id = `${k.month}|${k.loc ?? "group"}`;
    const g = groups.get(id) ?? { month: k.month, loc: k.loc, rows: [] };
    g.rows.push(rowOf(k));
    groups.set(id, g);
  }
  const order: FixedCostCategory[] = [...AMOUNT_CATEGORIES, "impuestos"];
  const sorted = [...groups.values()]
    .map((g) => ({
      ...g,
      rows: g.rows.sort(
        (a, b) => order.indexOf(a.category) - order.indexOf(b.category)
      ),
    }))
    .sort((a, b) =>
      a.month === b.month
        ? (a.loc ?? "").localeCompare(b.loc ?? "")
        : a.month < b.month
          ? -1
          : 1
    );
  const dupTax = new Set(
    keys
      .filter((k) => k.kind === "invalid_duplicate_tax")
      .flatMap((k) => k.lines.map((l) => l.id))
  );
  const unresolved: UnresolvedLine[] = [];
  for (const l of lines) {
    if (l.status !== "pending" || (inKey.has(l.id) && !dupTax.has(l.id)))
      continue;
    const reason: UnresolvedLine["reason"] = dupTax.has(l.id)
      ? "duplicate_tax"
      : !l.category
        ? "category"
        : l.amount === null
          ? "amount"
          : !l.month
            ? "month"
            : !l.scope
              ? "restaurant"
              : "other";
    const missingCategory = !l.category;
    const missingRestaurant = !l.scope;
    const blocker: UnresolvedLine["blocker"] = dupTax.has(l.id)
      ? "duplicate_tax"
      : l.amount === null || !(l.amount > 0)
        ? "amount"
        : !l.month
          ? "month"
          : !missingCategory && !missingRestaurant
            ? "other"
            : null;
    unresolved.push({
      id: l.id,
      raw: l.raw,
      amount: l.amount,
      missingCategory,
      missingRestaurant,
      blocker,
      suggested: l.category ? null : suggestCategory(l.raw),
      reason,
    });
  }
  return {
    fileName: preview?.file_name ?? null,
    sameFileSeenBefore: preview?.same_file_seen_before ?? false,
    groups: sorted,
    unresolved,
  };
}

/** The amount a row ends at, given the person's choice. null = undecided. */
export function rowAfter(
  row: ReviewRow,
  choice: OverlapChoice | undefined
): number | null {
  if (row.needsChoice)
    return choice === "replace"
      ? row.afterIfReplace
      : choice === "add"
        ? row.afterIfAdd
        : null;
  return row.after;
}

/** Overlaps still waiting for a choice (the confirmation waits for these). */
export function undecided(
  review: Review,
  choices: Readonly<Record<string, OverlapChoice>>
): ReviewRow[] {
  return review.groups
    .flatMap((g) => g.rows)
    .filter((r) => r.needsChoice && !choices[r.key]);
}

/** Rows that really change a recorded value (a no-op is shown but changes nothing). */
export function changedRows(
  review: Review,
  choices: Readonly<Record<string, OverlapChoice>>
): ReviewRow[] {
  return review.groups.flatMap((g) =>
    g.rows.filter((r) => {
      if (r.kind === "noop") return false;
      const a = rowAfter(r, choices[r.key]);
      return a === null || a !== r.before;
    })
  );
}

/**
 * The ONE request: every resolvable line of the file, the reviewed versions and
 * the overlap choices. Lines that cannot be resolved are not sent; the review
 * listed them by name before the confirmation.
 */
export function approvalBody(
  review: Review,
  preview: UploadPreview,
  choices: Readonly<Record<string, OverlapChoice>>,
  commandKey: string
) {
  const rows = review.groups.flatMap((g) => g.rows);
  const decisions: Record<string, OverlapChoice> = {};
  for (const r of rows)
    if (r.needsChoice && choices[r.key])
      for (const id of r.lineIds) decisions[id] = choices[r.key];
  return {
    draftId: preview.draft_id,
    draftVersion: preview.draft_version,
    commandKey,
    expected: Object.fromEntries(preview.keys.map((k) => [k.key, k.version])),
    lineIds: rows.flatMap((r) => r.lineIds),
    decisions,
  };
}

/**
 * "The month on screen did not change" is only ever said when the database's
 * own answer proves it: no category of that month and scope was changed.
 */
export function monthUnchanged(
  month: string,
  loc: string | null,
  categories: ReadonlyArray<{
    month: string;
    location_id: string | null;
    outcome: string;
  }>
): boolean {
  return !categories.some(
    (c) =>
      c.month === month &&
      (c.location_id ?? null) === loc &&
      c.outcome !== "unchanged"
  );
}

/** One category the command actually changed, exactly as the database reported it. */
export interface SavedRow {
  month: string;
  category: FixedCostCategory;
  loc: string | null;
  /** Money (or a % for impuestos). null = nothing was recorded before. */
  before: number | null;
  after: number | null;
}

export function savedRows(
  categories: ReadonlyArray<{
    month: string;
    category: string;
    location_id: string | null;
    outcome: string;
    total?: number | null;
    previous_total?: number | null;
  }>
): SavedRow[] {
  const order: string[] = [...AMOUNT_CATEGORIES, "impuestos"];
  return categories
    .filter((c) => c.outcome !== "unchanged")
    .map((c) => ({
      month: c.month,
      category: c.category as FixedCostCategory,
      loc: c.location_id ?? null,
      before: c.previous_total ?? null,
      after: c.total ?? null,
    }))
    .sort((a, b) =>
      a.month === b.month
        ? order.indexOf(a.category) - order.indexOf(b.category)
        : a.month < b.month
          ? -1
          : 1
    );
}

export type { AmountCategory };
