// R1-15d (mocks 3, 4, 8): the drill view of one menu dish. Everything is a
// client-side group-by over the dish's variant rows (already loaded): a
// dimension (tamaño, acompañante, punto, canal), filters on the others, a
// cross with a second dimension, and grouped values ("Papas" = Papas fritas
// + Puré + Papa al horno). Sums come from costing/rollup.ts; shares add up
// to exactly 100 after rounding, at every level. "Sin precio" is never $0.

import {
  largestRemainderShares,
  rollupLeaves,
  type RollupTotals,
} from "@/lib/restaurant/costing/rollup";
import type { MenuDishVariant } from "./menu-dishes";

export type DrillDimension = "product" | "size" | "side" | "point" | "channel";

export const DRILL_DIMENSIONS: ReadonlyArray<{
  id: DrillDimension;
  label: string;
  /** The value of `item_groups.dimension` (migration 048); null = not groupable (the product itself). */
  stored: "size" | "side" | "cooking_point" | "channel" | null;
}> = [
  { id: "product", label: "Producto", stored: null },
  { id: "size", label: "Tamaño", stored: "size" },
  { id: "side", label: "Acompañante", stored: "side" },
  { id: "point", label: "Punto", stored: "cooking_point" },
  { id: "channel", label: "Canal", stored: "channel" },
];

const NONE_LABEL: Record<DrillDimension, string> = {
  product: "Producto",
  size: "Sin tamaño",
  side: "Sin acompañante",
  point: "Sin punto",
  channel: "Salón",
};

/** The label a variant has on a dimension. */
export function dimensionValue(
  v: MenuDishVariant,
  dim: DrillDimension
): string {
  switch (dim) {
    case "product":
      return v.name.trim() || "Sin nombre";
    case "size":
      return v.size !== null
        ? `${v.size} ${v.size_unit === "personas" ? "personas" : "oz"}`
        : NONE_LABEL.size;
    case "side":
      return v.side?.trim() ? v.side.trim() : NONE_LABEL.side;
    case "point":
      return v.cooking_point?.trim()
        ? v.cooking_point.trim()
        : NONE_LABEL.point;
    case "channel":
      return v.channel === "eventos" ? "Eventos" : "Salón";
  }
}

/** One value, or the values of a group (a click on a grouped cell). */
/**
 * The dimensions that have real data for these rows, in display order. An
 * empty dimension is not offered: drinks have no cooking point, a group of
 * drinks no size. `product` (the rows themselves) is for groups of products.
 */
export function availableDimensions(
  variants: readonly MenuDishVariant[],
  opts: { product?: boolean } = {}
): DrillDimension[] {
  const out: DrillDimension[] = [];
  if (opts.product && new Set(variants.map((v) => v.name)).size >= 2)
    out.push("product");
  if (variants.some((v) => v.size !== null)) out.push("size");
  if (variants.some((v) => v.side?.trim())) out.push("side");
  if (variants.some((v) => v.cooking_point?.trim())) out.push("point");
  if (variants.some((v) => v.channel === "eventos")) out.push("channel");
  return out;
}

export type DrillFilters = Partial<
  Record<DrillDimension, string | readonly string[]>
>;

/** A named set of values of one dimension (a stored dimension_value group). */
export interface ValueGroup {
  id: string;
  name: string;
  values: ReadonlySet<string>;
  /** Milton suggested it (shows "✦ … agrupado por Milton"). */
  byMilton?: boolean;
}

export function applyFilters(
  variants: readonly MenuDishVariant[],
  filters: DrillFilters
): MenuDishVariant[] {
  const entries = Object.entries(filters) as [
    DrillDimension,
    string | readonly string[],
  ][];
  return variants.filter((v) =>
    entries.every(([dim, value]) =>
      typeof value === "string"
        ? dimensionValue(v, dim) === value
        : value.includes(dimensionValue(v, dim))
    )
  );
}

/** The distinct values of a dimension, biggest sales first. */
export function dimensionValues(
  variants: readonly MenuDishVariant[],
  dim: DrillDimension
): string[] {
  const sales = new Map<string, number>();
  for (const v of variants) {
    const k = dimensionValue(v, dim);
    sales.set(k, (sales.get(k) ?? 0) + v.net_sales);
  }
  return [...sales.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .map(([k]) => k);
}

const toLeaf = (v: MenuDishVariant) => ({
  key: v.key,
  units: v.units,
  net_sales: v.net_sales,
  cost_total: v.cost_total,
  covered: v.covered,
  status: v.status,
});

export interface DrillRow {
  /** A value of the dimension, or a group of values. */
  kind: "value" | "group";
  id: string;
  label: string;
  group?: ValueGroup;
  rollup: RollupTotals;
  /** % of the whole view; a group's share is the sum of its members' (they add up). */
  share_pct: number;
  members: DrillRow[];
}

/** The rows of one dimension: grouped values collapse under their group. */
export function drillRows(
  variants: readonly MenuDishVariant[],
  dim: DrillDimension,
  groups: readonly ValueGroup[] = []
): { rows: DrillRow[]; total: RollupTotals } {
  const byValue = new Map<string, MenuDishVariant[]>();
  for (const v of variants) {
    const k = dimensionValue(v, dim);
    byValue.set(k, [...(byValue.get(k) ?? []), v]);
  }
  const values = [...byValue.entries()]
    .map(([label, list]) => ({
      label,
      list,
      rollup: rollupLeaves(list.map(toLeaf)),
    }))
    .sort(
      (a, b) =>
        b.rollup.net_sales - a.rollup.net_sales ||
        a.label.localeCompare(b.label, "es")
    );
  // Shares over the values (leaf level), so everything adds up to 100.
  const shares = largestRemainderShares(values.map((x) => x.rollup.net_sales));
  const valueRows = new Map<string, DrillRow>(
    values.map((x, i) => [
      x.label,
      {
        kind: "value",
        id: `v:${x.label}`,
        label: x.label,
        rollup: x.rollup,
        share_pct: shares[i],
        members: [],
      },
    ])
  );

  // A value belongs to the first group that holds it (one group per value).
  const taken = new Set<string>();
  const rows: DrillRow[] = [];
  const groupRows: DrillRow[] = [];
  for (const g of groups) {
    const mine = [...valueRows.values()].filter(
      (r) => g.values.has(r.label) && !taken.has(r.label)
    );
    if (mine.length === 0) continue;
    for (const m of mine) taken.add(m.label);
    const list = mine.flatMap((m) => byValue.get(m.label) ?? []);
    groupRows.push({
      kind: "group",
      id: `g:${g.id}`,
      label: g.name,
      group: g,
      rollup: rollupLeaves(list.map(toLeaf)),
      share_pct: round1(mine.reduce((s, m) => s + m.share_pct, 0)),
      members: mine,
    });
  }
  for (const r of valueRows.values()) if (!taken.has(r.label)) rows.push(r);
  rows.push(...groupRows);
  rows.sort(
    (a, b) =>
      b.rollup.net_sales - a.rollup.net_sales ||
      a.label.localeCompare(b.label, "es")
  );
  return { rows, total: rollupLeaves(variants.map(toLeaf)) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface CrossTab {
  rowLabels: string[];
  colLabels: string[];
  /** % of the whole view per cell (all cells add up to exactly 100). */
  cells: number[][];
  rowTotals: number[];
  colTotals: number[];
  /** Sales of the cell, for the colour. */
  sales: number[][];
}

/** Rows × columns with each cell's share of the whole; totals are sums of the shown cells. */
export function crossTab(
  variants: readonly MenuDishVariant[],
  rowDim: DrillDimension,
  colDim: DrillDimension,
  rowGroups: readonly ValueGroup[] = [],
  colGroups: readonly ValueGroup[] = []
): CrossTab {
  const rowOf = labeler(variants, rowDim, rowGroups);
  const colOf = labeler(variants, colDim, colGroups);
  const rowLabels = rowOf.labels;
  const colLabels = colOf.labels;
  const sales = rowLabels.map(() => colLabels.map(() => 0));
  for (const v of variants) {
    const r = rowLabels.indexOf(rowOf.of(v));
    const c = colLabels.indexOf(colOf.of(v));
    if (r >= 0 && c >= 0) sales[r][c] += v.net_sales;
  }
  const flat = largestRemainderShares(sales.flat());
  const cells = rowLabels.map((_, r) =>
    colLabels.map((_, c) => flat[r * colLabels.length + c])
  );
  const rowTotals = cells.map((row) => round1(row.reduce((s, x) => s + x, 0)));
  const colTotals = colLabels.map((_, c) =>
    round1(cells.reduce((s, row) => s + row[c], 0))
  );
  return { rowLabels, colLabels, cells, rowTotals, colTotals, sales };
}

/** Labels of a dimension with grouped values replaced by their group, biggest first. */
function labeler(
  variants: readonly MenuDishVariant[],
  dim: DrillDimension,
  groups: readonly ValueGroup[]
) {
  const groupOfValue = new Map<string, string>();
  for (const g of groups) {
    for (const value of g.values) {
      if (!groupOfValue.has(value)) groupOfValue.set(value, g.name);
    }
  }
  const of = (v: MenuDishVariant) => {
    const value = dimensionValue(v, dim);
    return groupOfValue.get(value) ?? value;
  };
  const sales = new Map<string, number>();
  for (const v of variants)
    sales.set(of(v), (sales.get(of(v)) ?? 0) + v.net_sales);
  const labels = [...sales.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
    .map(([k]) => k);
  return { labels, of };
}

/** The groups of a dimension that apply to this dish (its own, and global ones). */
export function valueGroupsFor(
  groups: ReadonlyArray<{
    id: string;
    name: string;
    scope: string;
    dimension: string | null;
    menu_dish_id: string | null;
    source: string;
    status: string;
  }>,
  members: ReadonlyArray<{
    group_id: string;
    member_type: string;
    member_ref: string;
  }>,
  dim: DrillDimension,
  menuDishId: string
): ValueGroup[] {
  const stored = DRILL_DIMENSIONS.find((d) => d.id === dim)!.stored;
  if (!stored) return [];
  return groups
    .filter(
      (g) =>
        g.scope === "dimension_value" &&
        g.dimension === stored &&
        g.status === "confirmed" &&
        (g.menu_dish_id === null || g.menu_dish_id === menuDishId)
    )
    .map((g) => ({
      id: g.id,
      name: g.name,
      byMilton: g.source !== "user",
      values: new Set(
        members
          .filter(
            (m) => m.group_id === g.id && m.member_type === "dimension_value"
          )
          .map((m) => m.member_ref)
      ),
    }));
}

export interface ProfitRank {
  /** Row ids of the most and the least profitable (never overlapping). */
  best: Set<string>;
  worst: Set<string>;
}

/**
 * The top and bottom 3 by margin %, among rows that HAVE a cost. A row
 * without a price ("Sin precio") is never ranked: it is not 0%. With few
 * rows, fewer are marked (never more than half each, so they never overlap).
 */
export function profitRanking(
  rows: ReadonlyArray<{ id: string; rollup: { margin_pct: number | null } }>
): ProfitRank {
  const ranked = rows
    .filter((r) => r.rollup.margin_pct !== null)
    .slice()
    .sort((a, b) => b.rollup.margin_pct! - a.rollup.margin_pct!);
  const n = Math.min(3, Math.floor(ranked.length / 2));
  return {
    best: new Set(ranked.slice(0, n).map((r) => r.id)),
    worst: new Set(ranked.slice(ranked.length - n).map((r) => r.id)),
  };
}
