// lib/restaurant/fixed-cost-clusters.ts
//
// Costos fijos has ONE source of truth on screen: the confirmed amount of each
// cluster (Planilla, Alquiler, Servicios, Impuestos, Otros) for the month. The
// cards, the «Costos fijos» total and the break-even are all derived from it
// here, so they cannot disagree. Typing in an empty field or approving a
// scanned line both end up as a confirmed cluster amount; nothing else counts.
//
// Pure functions only (no React, no I/O): the component renders what these
// return, it does not do the math.

import {
  contributionMarginPct,
  effectiveFixedCosts,
  fixedCostCompleteness,
  fixedCostTotal,
  type AmountCategory,
  type EffectiveFixedCosts,
  type FixedCostCategory,
  type FixedCostLine,
  type FixedCostTotal,
  type MarginInputs,
} from "@/lib/restaurant/fixed-costs";
import {
  duplicateTaxIds,
  issuesOf,
  type DraftLine,
  type DraftScope,
} from "@/lib/restaurant/fixed-cost-upload";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** What a cluster holds for the month once confirmed. */
export interface Confirmed {
  /** An amount, or the tax rate (%) for impuestos. */
  value: number;
  /** 'upload' | 'manual' | 'repeat' | 'estimate' | null */
  source: string | null;
  label: string | null;
  /** «Se repite cada mes» for this cluster. */
  repeats?: boolean;
}

export type ClusterMap = Partial<Record<FixedCostCategory, Confirmed>>;

/** The saved lines of the screen's month and scope → confirmed clusters. */
export function clustersFromLines(
  lines: readonly (Pick<
    FixedCostLine,
    "category" | "amount" | "pct_of_sales" | "source" | "label"
  > &
    Partial<Pick<FixedCostLine, "repeats">>)[]
): ClusterMap {
  const out: ClusterMap = {};
  for (const l of lines) {
    const value = l.category === "impuestos" ? l.pct_of_sales : l.amount;
    if (value === null || value === undefined) continue;
    out[l.category] = {
      value,
      source: l.source ?? null,
      label: l.label,
      repeats: l.repeats === true,
    };
  }
  return out;
}

export interface Figures {
  costs: EffectiveFixedCosts;
  /** Sum of the confirmed amounts (null when none: never $0) + how many are missing. */
  fixed: FixedCostTotal;
  missingAmounts: AmountCategory[];
  /** Nothing confirmed for the month at all (nor a group share). */
  empty: boolean;
  /**
   * Break-even = confirmed fixed costs ÷ (gross margin % × open days). Uses
   * only what is confirmed: with some amounts still missing it is the figure
   * so far (`partial`), with none it is null.
   */
  breakEven: number | null;
  partial: boolean;
}

export function figuresOf(args: {
  clusters: ClusterMap;
  groupShares: Partial<Record<AmountCategory, number>>;
  groupImpuestosPct: number | null;
  margin: MarginInputs | null;
  openDays: number;
}): Figures {
  const own = (Object.keys(args.clusters) as FixedCostCategory[]).map((c) => {
    const v = (args.clusters[c] as Confirmed).value;
    return {
      category: c,
      amount: c === "impuestos" ? null : v,
      pct_of_sales: c === "impuestos" ? v : null,
    };
  });
  const costs = effectiveFixedCosts(
    own,
    args.groupShares,
    args.groupImpuestosPct
  );
  const fixed = fixedCostTotal(costs);
  const { missingAmounts } = fixedCostCompleteness(costs);
  const empty = fixed.total === null && costs.impuestosPct === null;

  let breakEven: number | null = null;
  if (fixed.total !== null && args.margin && args.openDays > 0) {
    const cm = contributionMarginPct(args.margin, costs.impuestosPct);
    if (cm !== null && cm > 0) breakEven = fixed.total / (cm * args.openDays);
  }
  return {
    costs,
    fixed,
    missingAmounts,
    empty,
    breakEven,
    partial: breakEven !== null && missingAmounts.length > 0,
  };
}

// ---------------------------------------------------------------------------
// The review list
// ---------------------------------------------------------------------------

/** What a line still needs before it can be approved: the question to ask. */
export type Needs =
  | "restaurant"
  | "category"
  | "amount"
  | "month"
  | "duplicate";

export type LineStatus =
  | { kind: "falta"; needs: Needs }
  | { kind: "ready" }
  | {
      kind: "diff";
      /** The cluster's confirmed amount today. */
      today: number;
      /** What this line proposes (replace). */
      proposes: number;
      /** today + proposes; null for a rate (never added up). */
      sum: number | null;
    };

export interface ScreenScope {
  /** The month on screen, YYYY-MM-01. */
  month: string;
  /** null = the group's shared costs. */
  locationId: string | null;
}

export function isHere(line: DraftLine, screen: ScreenScope): boolean {
  return (
    line.month === screen.month &&
    (screen.locationId
      ? line.scope?.kind === "restaurant" &&
        line.scope.locationId === screen.locationId
      : line.scope?.kind === "group")
  );
}

/** First thing missing, in the order a person would fix it. */
export function needsOf(line: DraftLine): Needs | null {
  const issues = issuesOf(line);
  if (issues.includes("restaurant")) return "restaurant";
  if (issues.includes("category")) return "category";
  if (issues.includes("amount")) return "amount";
  if (issues.includes("month")) return "month";
  return null;
}

/**
 * The confirmed value is this upload's own earlier approvals (its source is
 * 'upload' and it equals the sum of the approved lines of that cluster on this
 * screen): more lines of the cluster ADD to it, no question asked. A rate is
 * never added up, so impuestos is never "own".
 */
export function isOwnTotal(
  category: FixedCostCategory,
  confirmed: Confirmed | undefined,
  lines: readonly DraftLine[],
  screen: ScreenScope
): boolean {
  if (!confirmed || category === "impuestos" || confirmed.source !== "upload")
    return false;
  const mine = lines.filter(
    (l) =>
      l.status === "approved" && l.category === category && isHere(l, screen)
  );
  if (mine.length === 0) return false;
  const sum = round2(mine.reduce((s, l) => s + (l.amount ?? 0), 0));
  return sum === round2(confirmed.value);
}

/** Where each pending line stands: ready, ⚑ Falta (and what), or a diff to decide. */
export function lineStatuses(
  lines: readonly DraftLine[],
  clusters: ClusterMap,
  screen: ScreenScope
): Map<string, LineStatus> {
  const out = new Map<string, LineStatus>();
  const pending = lines.filter((l) => l.status === "pending");
  const dup = duplicateTaxIds(pending);
  for (const l of pending) {
    const needs = needsOf(l);
    if (needs) {
      out.set(l.id, { kind: "falta", needs });
      continue;
    }
    if (dup.has(l.id)) {
      out.set(l.id, { kind: "falta", needs: "duplicate" });
      continue;
    }
    const c = l.category as FixedCostCategory;
    const today = clusters[c];
    if (
      isHere(l, screen) &&
      today &&
      today.value !== l.amount &&
      !isOwnTotal(c, today, lines, screen)
    ) {
      out.set(l.id, {
        kind: "diff",
        today: today.value,
        proposes: l.amount as number,
        sum:
          c === "impuestos" ? null : round2(today.value + (l.amount as number)),
      });
      continue;
    }
    out.set(l.id, { kind: "ready" });
  }
  return out;
}

/** «Aprobar todo (n · $X)»: only lines that can be approved without a decision. */
export function approvableAll(
  lines: readonly DraftLine[],
  statuses: ReadonlyMap<string, LineStatus>
): { ids: string[]; count: number; total: number; deciding: number } {
  const pending = lines.filter((l) => l.status === "pending");
  const ready = pending.filter((l) => statuses.get(l.id)?.kind === "ready");
  return {
    ids: ready.map((l) => l.id),
    count: ready.length,
    total: round2(
      ready.reduce(
        (s, l) => s + (l.category === "impuestos" ? 0 : (l.amount ?? 0)),
        0
      )
    ),
    deciding: pending.filter((l) => statuses.get(l.id)?.kind === "diff").length,
  };
}

/** Falta lines first (they need a person), then the rest in file order. */
export function sortForReview(
  lines: readonly DraftLine[],
  statuses: ReadonlyMap<string, LineStatus>
): DraftLine[] {
  const rank = (l: DraftLine) =>
    statuses.get(l.id)?.kind === "falta"
      ? 0
      : statuses.get(l.id)?.kind === "diff"
        ? 1
        : 2;
  return lines
    .filter((l) => l.status === "pending")
    .map((l, i) => ({ l, i }))
    .sort((a, b) => rank(a.l) - rank(b.l) || a.i - b.i)
    .map((x) => x.l);
}

export type ApproveMode = "auto" | "replace" | "add";

/**
 * What a cluster holds after approving `lines` (all of one category) on top of
 * `today`. 'replace' ignores today; 'add' and 'auto' add to it. A rate is
 * never added: the last one wins.
 */
export function clusterAfter(
  category: FixedCostCategory,
  today: number | null,
  lines: readonly DraftLine[],
  mode: ApproveMode
): number {
  if (category === "impuestos") return lines[lines.length - 1]?.amount ?? 0;
  const sum = round2(lines.reduce((s, l) => s + (l.amount ?? 0), 0));
  return round2((mode === "replace" ? 0 : (today ?? 0)) + sum);
}

/**
 * What this file proposes for a cluster on this screen: its approved lines plus
 * the ready pending ones (a rate: the last one). Compared with last month.
 */
export function fileProposal(
  lines: readonly DraftLine[],
  category: FixedCostCategory,
  statuses: ReadonlyMap<string, LineStatus>,
  screen: ScreenScope
): number | null {
  const mine = lines.filter(
    (l) =>
      l.category === category &&
      isHere(l, screen) &&
      (l.status === "approved" ||
        (l.status === "pending" && statuses.get(l.id)?.kind !== "falta"))
  );
  if (mine.length === 0) return null;
  return clusterAfter(category, null, mine, "replace");
}

/** The percentage change as a fraction (0.12 = +12%); null when there is no last month. */
export function vsLastMonth(
  value: number,
  last: number | undefined
): number | null {
  if (last === undefined || last === 0) return null;
  return (value - last) / last;
}

export type { DraftScope };

// ---------------------------------------------------------------------------
// What a cluster card says about where its amount came from
// ---------------------------------------------------------------------------

const LABEL_MAX = 120;

/** «Agua + Seguro»: the concepts behind a cluster amount, as the server saves them. */
export function conceptLabel(lines: readonly DraftLine[]): string | null {
  const parts = lines.map((l) => l.raw).filter(Boolean);
  return parts.length ? parts.join(" + ").slice(0, LABEL_MAX) : null;
}

export interface ClusterItem {
  id: string;
  raw: string;
  amount: number;
}

/** The lines this upload approved into each amount cluster of the screen. */
export function approvedItems(
  lines: readonly DraftLine[],
  screen: ScreenScope
): Partial<Record<FixedCostCategory, ClusterItem[]>> {
  const out: Partial<Record<FixedCostCategory, ClusterItem[]>> = {};
  for (const l of lines) {
    if (
      l.status !== "approved" ||
      !l.category ||
      l.category === "impuestos" ||
      l.amount === null ||
      !isHere(l, screen)
    )
      continue;
    (out[l.category] ??= []).push({ id: l.id, raw: l.raw, amount: l.amount });
  }
  return out;
}

/**
 * The lines listed under a card: only when several lines make up the amount and
 * they add up to it exactly (a hand edit since makes the list stale: hidden).
 */
export function itemsToShow(
  items: readonly ClusterItem[] | undefined,
  cluster: Confirmed | undefined
): ClusterItem[] {
  if (!items || items.length < 2 || !cluster || cluster.source !== "upload")
    return [];
  const sum = round2(items.reduce((n, i) => n + i.amount, 0));
  return sum === round2(cluster.value) ? [...items] : [];
}

/** How many of the five clusters have a confirmed amount. */
export function confirmedCount(clusters: ClusterMap): number {
  return Object.keys(clusters).length;
}
