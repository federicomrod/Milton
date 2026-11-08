// lib/restaurant/fixed-cost-overview.ts
//
// The multi-month overview of Costos fijos as a PURE function of data the page
// already reads. It computes nothing financial of its own: totals, completeness
// and the break-even come from the shared engine (`computeFixedFigures`, via the
// `FixedFigures` each month view carries). This file only decides how to SHOW
// what is known, and above all what is NOT known:
//
//   recorded  a confirmed amount for the month
//   zero      a confirmed amount that is exactly 0 (the person said "nothing")
//   recurring a recurring reference carried from an earlier month: an
//             expectation, NOT a recorded actual and NEVER added to a total
//   draft     an unconfirmed amount: not counted
//   missing   nothing known. Never shown as 0.
//
// Item positions come only from canonical items. A legacy aggregate keeps its
// single "unknown detail" row; no breakdown is ever invented.

import {
  AMOUNT_CATEGORIES,
  type AmountCategory,
  type FixedCostLine,
} from "@/lib/restaurant/fixed-costs";
import type { FixedFigures } from "@/lib/restaurant/fixed-cost-engine";
import type { ItemView } from "@/lib/restaurant/fixed-costs-server";
import { getDictionary } from "@/lib/i18n";
import type { PreferredLanguage } from "@/lib/restaurant/language";

export type CellState = "recorded" | "zero" | "recurring" | "draft" | "missing";

export interface OverviewCell {
  state: CellState;
  /** The recorded amount (recorded / zero); null otherwise. */
  amount: number | null;
  /** recurring: the earlier month's amount, as a reference only. */
  reference: number | null;
  referenceMonth: string | null;
  /** itemized = the sum of canonical items; legacy_total = no known detail. */
  detail: "itemized" | "legacy_total" | null;
  source: FixedCostLine["source"] | null;
  lineId: string | null;
}

export interface OverviewPosition {
  /** Stable within the overview: the folded label, or "legacy" for an unknown-detail base. */
  key: string;
  label: string | null;
  kind: "item" | "legacy_base";
  /** month → amount; a month without the position is simply absent (not 0). */
  amounts: Record<string, { amount: number; item: ItemView }>;
}

export interface OverviewMonth {
  month: string;
  cells: Record<AmountCategory, OverviewCell>;
  /** This restaurant's share of the group lines, per category. Read-only. */
  shared: Partial<Record<AmountCategory, number>>;
  sharedTotal: number | null;
  /** Σ own recorded amounts; null when none is recorded (never 0). */
  localTotal: number | null;
  /** Local + shared, counted once. Straight from the engine. */
  combinedTotal: number | null;
  /** The sales-tax RATE, kept apart from every money figure. */
  taxRate: number | null;
  taxSource: "local" | "group" | "missing";
  figures: FixedFigures;
  missing: AmountCategory[];
  /** complete = all four categories known; partial = some known; none = nothing known. */
  completeness: "complete" | "partial" | "none";
  /** The daily target is only offered when the engine says the figures are complete. */
  breakEvenPerDay: number | null;
}

export interface MonthInput {
  month: string;
  lines: FixedCostLine[];
  items: Partial<Record<AmountCategory, ItemView[]>>;
  groupShares: Partial<Record<AmountCategory, number>>;
  groupImpuestosPct: number | null;
  figures: FixedFigures;
}

export interface Overview {
  /** Oldest first: September | October | November. */
  months: OverviewMonth[];
  positions: Record<AmountCategory, OverviewPosition[]>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** «octubre 2026» in the person's language (month names from the dictionary). */
export function monthText(month: string, lang: PreferredLanguage): string {
  const [y, m] = month.split("-").map(Number);
  return `${getDictionary(lang).rentabilidad.months[m - 1]} ${y}`;
}

/** The window of `size` months ending in `end` (YYYY-MM-01), oldest first. */
export function monthWindow(end: string, size = 3): string[] {
  const [y, m] = end.split("-").map(Number);
  const out: string[] = [];
  for (let i = size - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`
    );
  }
  return out;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function cellFor(
  month: string,
  category: AmountCategory,
  lines: readonly FixedCostLine[],
  earlier: readonly FixedCostLine[]
): OverviewCell {
  const own = lines.find((l) => l.category === category);
  if (own && own.amount !== null) {
    if (own.status === "confirmed") {
      return {
        state: own.amount === 0 ? "zero" : "recorded",
        amount: own.amount,
        reference: null,
        referenceMonth: null,
        detail: own.detail_state ?? "legacy_total",
        source: own.source,
        lineId: own.id ?? null,
      };
    }
    return {
      state: "draft",
      amount: null,
      reference: null,
      referenceMonth: null,
      detail: null,
      source: own.source,
      lineId: own.id ?? null,
    };
  }
  // Nothing recorded. A recurring line of the closest earlier month is an
  // expectation to show next to the gap, never a value.
  const ref = earlier
    .filter(
      (l) =>
        l.category === category &&
        l.repeats &&
        l.status === "confirmed" &&
        l.amount !== null &&
        l.month < month
    )
    .sort((a, b) => (a.month < b.month ? 1 : -1))[0];
  if (ref)
    return {
      state: "recurring",
      amount: null,
      reference: ref.amount,
      referenceMonth: ref.month,
      detail: null,
      source: null,
      lineId: null,
    };
  return {
    state: "missing",
    amount: null,
    reference: null,
    referenceMonth: null,
    detail: null,
    source: null,
    lineId: null,
  };
}

export function buildOverview(
  inputs: readonly MonthInput[],
  /** Lines of months BEFORE the window, only to find recurring references. */
  earlierLines: readonly FixedCostLine[] = []
): Overview {
  const months: OverviewMonth[] = inputs.map((inp) => {
    const earlier = [
      ...earlierLines,
      ...inputs.filter((o) => o.month < inp.month).flatMap((o) => o.lines),
    ];
    const cells = {} as Record<AmountCategory, OverviewCell>;
    for (const c of AMOUNT_CATEGORIES)
      cells[c] = cellFor(inp.month, c, inp.lines, earlier);
    const recorded = AMOUNT_CATEGORIES.filter(
      (c) => cells[c].amount !== null
    ).map((c) => cells[c].amount as number);
    const localTotal = recorded.length
      ? round2(recorded.reduce((s, n) => s + n, 0))
      : null;
    const sharedVals = AMOUNT_CATEGORIES.filter(
      (c) => inp.groupShares[c] !== undefined
    ).map((c) => inp.groupShares[c] as number);
    const sharedTotal = sharedVals.length
      ? round2(sharedVals.reduce((s, n) => s + n, 0))
      : null;
    const f = inp.figures;
    const missing = AMOUNT_CATEGORIES.filter((c) =>
      f.missing.some((m) => m.kind === "category" && m.category === c)
    );
    return {
      month: inp.month,
      cells,
      shared: inp.groupShares,
      sharedTotal,
      localTotal,
      combinedTotal: f.total,
      taxRate: f.tax.kind === "missing" ? null : f.tax.rate,
      taxSource: f.tax.kind,
      figures: f,
      missing,
      completeness:
        f.known.length === 0
          ? "none"
          : f.known.length === AMOUNT_CATEGORIES.length
            ? "complete"
            : "partial",
      // Never a final-looking target while anything is missing.
      breakEvenPerDay: f.status === "complete" ? f.breakEven : null,
    };
  });

  const positions = {} as Record<AmountCategory, OverviewPosition[]>;
  for (const c of AMOUNT_CATEGORIES) {
    const byKey = new Map<string, OverviewPosition>();
    for (const inp of inputs) {
      for (const it of inp.items[c] ?? []) {
        const key = it.kind === "legacy_base" ? "legacy" : fold(it.label ?? "");
        let p = byKey.get(key);
        if (!p) {
          p = { key, label: it.label, kind: it.kind, amounts: {} };
          byKey.set(key, p);
        }
        // Two items of one month with the same label are summed into the one
        // position (each stays a separate canonical item underneath).
        const prev = p.amounts[inp.month]?.amount ?? 0;
        p.amounts[inp.month] = {
          amount: round2(prev + it.cents / 100),
          item: it,
        };
      }
    }
    positions[c] = [...byKey.values()].sort((a, b) =>
      a.kind === b.kind
        ? (a.label ?? "").localeCompare(b.label ?? "")
        : a.kind === "legacy_base"
          ? 1
          : -1
    );
  }
  return { months, positions };
}
