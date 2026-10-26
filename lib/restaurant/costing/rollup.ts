// lib/restaurant/costing/rollup.ts
//
// R1-15b (Agrupaciones F1): the ONE place that rolls variant rows up into a
// group, a dish, a dimension value or a whole view. Every screen uses it;
// there is no second calculation anywhere. Pure (no I/O, no React).
//
// The rules (agrupaciones-proposal.md):
//   1. Units, sales and cost are SUMMED over the leaf rows.
//   2. Margin % = (Σsales − Σcost) / Σsales, cost % = Σcost / Σsales:
//      ratios of sums, never an average of children's percentages.
//   3. Share % = Σsales(node) / Σsales(parent view). The children of a node
//      add up to 100% of it; rounded with the largest remainder so the
//      displayed values add up to exactly 100.
//   4. Coverage = Σsales of the rows that have a cost / Σsales of the node.
//   5. Margin and cost % use only the rows that have a cost; when coverage is
//      under 100% it is shown next to them ("62% · cobertura 83%"). A row
//      without a price is "Sin precio", never $0.
//   6. Problems are counted per node, at the level being shown.
//
// Grouping: a product belongs to exactly ONE group per hierarchy. A person's
// explicit choice (a group_members row) wins over the product's menu dish
// (the auto level); a restaurant-only group never takes another
// restaurant's sales; a suggestion does not count until it is confirmed.

import { DISH_STATUS_LABELS, type DishStatus } from "./dish-status";

// ---------------------------------------------------------------------------
// Sums
// ---------------------------------------------------------------------------

export interface RollupLeaf {
  /** Stable identity of the row (the product, or the product in one restaurant part). */
  key: string;
  units: number;
  net_sales: number;
  /** Cost of ALL the units sold; null = unknown (Sin precio). Never 0 for a missing price. */
  cost_total: number | null;
  /** The cost is approved (counts toward coverage). */
  covered: boolean;
  status: DishStatus;
}

export interface RollupTotals {
  units: number;
  net_sales: number;
  /** Sales of the rows that have a cost (the base of margin and cost %). */
  cost_known_sales: number;
  /** Cost of those rows; null when no row has a cost. */
  cost_total: number | null;
  food_cost_pct: number | null;
  margin: number | null;
  margin_pct: number | null;
  /** 0–1: sales of covered rows / sales of the node. */
  coverage: number;
  cost_status: DishStatus;
  /** Rows without a price (their sales are in net_sales, their cost is unknown). */
  rows_without_cost: number;
  /** Rows that are a problem: Falta precio, Borrador or Sin receta. */
  problem_count: number;
  row_count: number;
  /** Variants (leaf rows) whose own status is «Aprobado». */
  approved_count: number;
  /** All the variants (leaf rows) of the node. */
  variant_count: number;
  /** Sales of the leaves that are NOT covered (the part still without an approved cost). */
  pending_sales: number;
  /**
   * The worst status among the leaves that are not «Aprobado»
   * (falta_precio > estimado > borrador > sin_receta); null when every leaf
   * is approved. This is the ONE bucket a dish is counted in by problemCounts.
   */
  pending_status: DishStatus | null;
  /** Sales of the non-covered leaves, per each leaf's own status. */
  pending_sales_by_status: Partial<Record<DishStatus, number>>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The most worrying status of a set of rows. */
export function worstStatus(statuses: readonly DishStatus[]): DishStatus {
  if (statuses.includes("falta_precio")) return "falta_precio";
  if (statuses.includes("estimado")) return "estimado";
  if (statuses.includes("borrador")) return "borrador";
  if (statuses.includes("sin_receta")) return "sin_receta";
  return "aprobado";
}

export function rollupLeaves(leaves: readonly RollupLeaf[]): RollupTotals {
  const units = leaves.reduce((s, v) => s + v.units, 0);
  const net = leaves.reduce((s, v) => s + v.net_sales, 0);
  const known = leaves.filter((v) => v.cost_total !== null);
  const knownSales = known.reduce((s, v) => s + v.net_sales, 0);
  const costTotal = known.length
    ? known.reduce((s, v) => s + (v.cost_total ?? 0), 0)
    : null;
  const coveredSales = leaves
    .filter((v) => v.covered)
    .reduce((s, v) => s + v.net_sales, 0);
  const pendingByStatus: Partial<Record<DishStatus, number>> = {};
  let pendingSales = 0;
  for (const v of leaves) {
    if (v.covered) continue;
    pendingSales += v.net_sales;
    pendingByStatus[v.status] = round2(
      (pendingByStatus[v.status] ?? 0) + v.net_sales
    );
  }
  const notApproved = leaves
    .filter((v) => v.status !== "aprobado")
    .map((v) => v.status);
  return {
    units: round2(units),
    net_sales: round2(net),
    cost_known_sales: round2(knownSales),
    cost_total: costTotal,
    food_cost_pct:
      costTotal !== null && knownSales > 0
        ? (costTotal / knownSales) * 100
        : null,
    margin: costTotal !== null ? knownSales - costTotal : null,
    margin_pct:
      costTotal !== null && knownSales > 0
        ? ((knownSales - costTotal) / knownSales) * 100
        : null,
    coverage: net > 0 ? coveredSales / net : 0,
    cost_status:
      net > 0 && coveredSales >= net - 0.005
        ? "aprobado"
        : worstStatus(leaves.map((v) => v.status)),
    rows_without_cost: leaves.length - known.length,
    problem_count: leaves.filter(
      (v) =>
        v.status === "falta_precio" ||
        v.status === "sin_receta" ||
        v.status === "borrador"
    ).length,
    row_count: leaves.length,
    approved_count: leaves.filter((v) => v.status === "aprobado").length,
    variant_count: leaves.length,
    pending_sales: round2(pendingSales),
    pending_status: notApproved.length > 0 ? worstStatus(notApproved) : null,
    pending_sales_by_status: pendingByStatus,
  };
}

/** Said once, next to every coverage number of a group. */
export const GROUP_COVERAGE_TIP =
  "Cobertura = ventas de productos con costo aprobado / ventas del plato";

/**
 * The status chip of a GROUP of variants, honest about its members: when only
 * some are approved it says «Aprobado 1 de 3» (tone: warning) instead of the
 * worst member's status; all approved → «Aprobado»; none → the worst status.
 */
export function groupStatusDisplay(node: {
  cost_status: DishStatus;
  approved_count?: number;
  variant_count?: number;
}): { status: DishStatus; label: string; mixed: boolean } {
  return groupStatusOf({
    cost_status: node.cost_status,
    approved_count: node.approved_count ?? 0,
    variant_count: node.variant_count ?? 0,
  });
}

function groupStatusOf(node: {
  cost_status: DishStatus;
  approved_count: number;
  variant_count: number;
}): { status: DishStatus; label: string; mixed: boolean } {
  const mixed =
    node.variant_count > 1 &&
    node.approved_count > 0 &&
    node.approved_count < node.variant_count;
  if (mixed) {
    return {
      status: node.cost_status,
      label: `Aprobado ${node.approved_count} de ${node.variant_count}`,
      mixed: true,
    };
  }
  if (node.variant_count > 0 && node.approved_count === node.variant_count) {
    return { status: "aprobado", label: "Aprobado", mixed: false };
  }
  return {
    status: node.cost_status,
    label: DISH_STATUS_LABELS[node.cost_status],
    mixed: false,
  };
}

/**
 * "62% · cobertura 83%": the margin over the rows that have a cost, with the
 * coverage next to it when it is under 100%. No cost at all = "Sin precio".
 */
export function marginLabel(r: RollupTotals): string {
  if (r.margin_pct === null) return "Sin precio";
  const pct = `${Math.round(r.margin_pct)}%`;
  return r.coverage < 0.9995
    ? `${pct} · cobertura ${Math.round(r.coverage * 100)}%`
    : pct;
}

/** Same as marginLabel, for the cost % column. */
export function costPctLabel(r: RollupTotals): string {
  if (r.food_cost_pct === null) return "Sin precio";
  const pct = `${Math.round(r.food_cost_pct)}%`;
  return r.coverage < 0.9995
    ? `${pct} · cobertura ${Math.round(r.coverage * 100)}%`
    : pct;
}

// ---------------------------------------------------------------------------
// Shares that add up to exactly 100
// ---------------------------------------------------------------------------

/**
 * Percentages of `values` over their sum, rounded to `decimals` with the
 * largest remainder method, so they add up to EXACTLY 100 (not 99.9 or
 * 100.1). All zero (or empty) → all zeros. Negative values count as 0.
 */
export function largestRemainderShares(
  values: readonly number[],
  decimals = 1
): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  if (total <= 0) return clean.map(() => 0);
  const unit = 10 ** decimals;
  const target = 100 * unit;
  const exact = clean.map((v) => (v / total) * target);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  let left = target - floors.reduce((s, x) => s + x, 0);
  const order = exact
    .map((x, i) => ({ i, rem: x - Math.floor(x + 1e-9) }))
    // Biggest remainder first; ties go to the bigger value, then the earlier row.
    .sort((a, b) => b.rem - a.rem || clean[b.i] - clean[a.i] || a.i - b.i);
  const out = floors.slice();
  for (const { i } of order) {
    if (left <= 0) break;
    if (clean[i] <= 0) continue;
    out[i] += 1;
    left -= 1;
  }
  return out.map((x) => x / unit);
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type GroupSource = "auto" | "ai_suggested" | "user";
export type GroupStatus = "suggested" | "confirmed";

/** A group as stored (migration 048), product hierarchy. */
export interface TreeGroup {
  id: string;
  name: string;
  parent_id: string | null;
  /** NULL = every restaurant. */
  restaurant_id: string | null;
  source: GroupSource;
  status: GroupStatus;
  /** The menu dish an AUTO group stands for. */
  menu_dish_id: string | null;
  sort_order?: number;
}

/** A person's explicit membership (migration 048). */
export interface TreeMember {
  group_id: string;
  /** The product (odoo_product_id as text). */
  member_ref: string;
}

export interface TreeLeaf extends RollupLeaf {
  /** What group_members.member_ref points at (the product). */
  ref: string;
  name: string;
  /** Restaurants whose sales this row holds; null = unknown / all of them. */
  restaurant_ids?: readonly string[] | null;
  /** The menu dish the product belongs to (the auto level), if any. */
  menu_dish_id?: string | null;
  menu_dish_name?: string | null;
}

export interface TreeNode {
  /** Stable id: the group's id, `auto:<menu dish id>` for a dish whose group is not stored, or the leaf's key. */
  id: string;
  kind: "group" | "leaf";
  name: string;
  group: TreeGroup | null;
  /** True for a menu dish that has no stored auto group yet. */
  virtual: boolean;
  leaf: TreeLeaf | null;
  children: TreeNode[];
  rollup: RollupTotals;
  /** % of the PARENT view, rounded so siblings add up to exactly 100. */
  share_pct: number;
  depth: number;
}

export interface GroupTree {
  /** Groups and ungrouped products, top level, shares of the whole view. */
  top: TreeNode[];
  /** Products in no group at all (also present in `top` as leaves). */
  ungrouped: TreeLeaf[];
  /** The whole view. */
  total: RollupTotals;
}

const AUTO_PREFIX = "auto:";

function groupAppliesTo(group: TreeGroup, leaf: TreeLeaf): boolean {
  if (group.status !== "confirmed") return false;
  // The Plato del menú level is decided by the product's own link
  // (pos_product_links.menu_dish_id): a product is always in its dish, for
  // every restaurant, whatever restaurant the dish was created for.
  if (group.source === "auto") return true;
  if (!group.restaurant_id) return true;
  // A restaurant-only group never takes another restaurant's sales: the row
  // must be entirely that restaurant's.
  const rs = leaf.restaurant_ids;
  return !!rs && rs.length > 0 && rs.every((r) => r === group.restaurant_id);
}

/**
 * Build the product-hierarchy tree from leaf rows, the stored groups and a
 * person's explicit memberships. See the header for the resolution rules.
 */
export function buildGroupTree(input: {
  leaves: readonly TreeLeaf[];
  groups: readonly TreeGroup[];
  members: readonly TreeMember[];
}): GroupTree {
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  const autoByDish = new Map<string, TreeGroup>();
  for (const g of input.groups) {
    if (g.source === "auto" && g.menu_dish_id && g.status === "confirmed") {
      autoByDish.set(g.menu_dish_id, g);
    }
  }
  const explicit = new Map<string, TreeGroup[]>();
  for (const m of input.members) {
    const g = groupById.get(m.group_id);
    if (!g) continue;
    const list = explicit.get(m.member_ref) ?? [];
    list.push(g);
    explicit.set(m.member_ref, list);
  }

  // Which node does each leaf sit in?
  const leavesOf = new Map<string, TreeLeaf[]>();
  const virtualDishes = new Map<string, { id: string; name: string }>();
  const ungrouped: TreeLeaf[] = [];
  const put = (nodeId: string, leaf: TreeLeaf) => {
    const list = leavesOf.get(nodeId) ?? [];
    list.push(leaf);
    leavesOf.set(nodeId, list);
  };
  for (const leaf of input.leaves) {
    // 1) A person's choice wins (the restaurant's own group before a shared one).
    // Deterministic whatever order the rows came in: the restaurant's own
    // group first, then a stable order by id.
    const picks = (explicit.get(leaf.ref) ?? [])
      .filter((g) => groupAppliesTo(g, leaf))
      .sort(
        (a, b) =>
          Number(!!b.restaurant_id) - Number(!!a.restaurant_id) ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      );
    const pick = picks[0];
    if (pick) {
      put(pick.id, leaf);
      continue;
    }
    // 2) Its menu dish (the auto level), stored or not.
    if (leaf.menu_dish_id) {
      const stored = autoByDish.get(leaf.menu_dish_id);
      if (stored) {
        put(stored.id, leaf);
        continue;
      }
      {
        const id = leaf.menu_dish_id.startsWith(AUTO_PREFIX)
          ? leaf.menu_dish_id
          : `${AUTO_PREFIX}${leaf.menu_dish_id}`;
        virtualDishes.set(id, {
          id,
          name: leaf.menu_dish_name ?? leaf.name,
        });
        put(id, leaf);
        continue;
      }
    }
    ungrouped.push(leaf);
  }

  // Nodes: every confirmed group that has leaves below it or is a person's
  // own (a user group stays even while empty); an auto group only with sales.
  const childrenOf = new Map<string, TreeGroup[]>();
  const confirmed = input.groups.filter((g) => g.status === "confirmed");
  const hasLeavesBelow = new Map<string, boolean>();
  const below = (id: string): boolean => {
    const cached = hasLeavesBelow.get(id);
    if (cached !== undefined) return cached;
    hasLeavesBelow.set(id, false); // cycle guard
    const direct = (leavesOf.get(id)?.length ?? 0) > 0;
    const sub = confirmed
      .filter((g) => g.parent_id === id)
      .some((g) => below(g.id));
    const result = direct || sub;
    hasLeavesBelow.set(id, result);
    return result;
  };
  // A restaurant-only group of a restaurant that is not in this view is not
  // shown (it would only be an empty row). Only when every row says which
  // restaurant it belongs to; otherwise nothing is hidden.
  const viewRestaurants = new Set<string>();
  let restaurantsKnown = input.leaves.length > 0;
  for (const l of input.leaves) {
    if (!l.restaurant_ids || l.restaurant_ids.length === 0) {
      restaurantsKnown = false;
      break;
    }
    for (const r of l.restaurant_ids) viewRestaurants.add(r);
  }
  const inView = (g: TreeGroup) =>
    // The Plato del menú level follows the product's link, whatever restaurant the dish was created for.
    g.source === "auto" ||
    !restaurantsKnown ||
    !g.restaurant_id ||
    viewRestaurants.has(g.restaurant_id);
  const shown = confirmed.filter(
    (g) => inView(g) && (g.source !== "auto" || below(g.id))
  );
  const shownIds = new Set(shown.map((g) => g.id));
  for (const g of shown) {
    const parent =
      g.parent_id && shownIds.has(g.parent_id) ? g.parent_id : "__top__";
    const list = childrenOf.get(parent) ?? [];
    list.push(g);
    childrenOf.set(parent, list);
  }

  const leafNode = (leaf: TreeLeaf, depth: number): TreeNode => ({
    id: leaf.key,
    kind: "leaf",
    name: leaf.name,
    group: null,
    virtual: false,
    leaf,
    children: [],
    rollup: rollupLeaves([leaf]),
    share_pct: 0,
    depth,
  });

  const collect = (node: TreeNode): TreeLeaf[] =>
    node.kind === "leaf" && node.leaf
      ? [node.leaf]
      : node.children.flatMap(collect);

  const finishGroup = (
    id: string,
    name: string,
    group: TreeGroup | null,
    virtual: boolean,
    children: TreeNode[],
    depth: number
  ): TreeNode => {
    const node: TreeNode = {
      id,
      kind: "group",
      name,
      group,
      virtual,
      leaf: null,
      children,
      rollup: rollupLeaves(children.flatMap(collect)),
      share_pct: 0,
      depth,
    };
    return node;
  };

  const order = (a: { sales: number; name: string }, b: typeof a) =>
    b.sales - a.sales || a.name.localeCompare(b.name, "es");

  const groupNode = (g: TreeGroup, depth: number): TreeNode => {
    const subs = (childrenOf.get(g.id) ?? []).map((c) =>
      groupNode(c, depth + 1)
    );
    const direct = (leavesOf.get(g.id) ?? []).map((l) =>
      leafNode(l, depth + 1)
    );
    const children = [...subs, ...direct].sort((a, b) =>
      order(
        { sales: a.rollup.net_sales, name: a.name },
        { sales: b.rollup.net_sales, name: b.name }
      )
    );
    const node = finishGroup(g.id, g.name, g, false, children, depth);
    setShares(node);
    return node;
  };

  const topGroups = (childrenOf.get("__top__") ?? []).map((g) =>
    groupNode(g, 0)
  );
  const topVirtual = [...virtualDishes.values()].map((v) => {
    const children = (leavesOf.get(v.id) ?? [])
      .map((l) => leafNode(l, 1))
      .sort((a, b) =>
        order(
          { sales: a.rollup.net_sales, name: a.name },
          { sales: b.rollup.net_sales, name: b.name }
        )
      );
    const node = finishGroup(v.id, v.name, null, true, children, 0);
    setShares(node);
    return node;
  });
  const top = [
    ...topGroups,
    ...topVirtual,
    ...ungrouped.map((l) => leafNode(l, 0)),
  ].sort((a, b) =>
    order(
      { sales: a.rollup.net_sales, name: a.name },
      { sales: b.rollup.net_sales, name: b.name }
    )
  );
  const shares = largestRemainderShares(top.map((n) => n.rollup.net_sales));
  top.forEach((n, i) => (n.share_pct = shares[i]));

  return { top, ungrouped, total: rollupLeaves(input.leaves) };
}

/** Children's shares of their parent, adding up to exactly 100. */
function setShares(node: TreeNode): void {
  const shares = largestRemainderShares(
    node.children.map((c) => c.rollup.net_sales)
  );
  node.children.forEach((c, i) => (c.share_pct = shares[i]));
}

/** Every leaf under a node. */
export function leavesUnder(node: TreeNode): TreeLeaf[] {
  return node.kind === "leaf" && node.leaf
    ? [node.leaf]
    : node.children.flatMap(leavesUnder);
}

/** Walk the tree (depth first). */
export function walkTree(
  nodes: readonly TreeNode[],
  visit: (node: TreeNode) => void
): void {
  for (const n of nodes) {
    visit(n);
    walkTree(n.children, visit);
  }
}

/** Agrupados + Sin agrupar = Todos: counts of products by whether a group holds them. */
export function groupingCounts(tree: GroupTree): {
  all: number;
  grouped: number;
  ungrouped: number;
  ungrouped_sales: number;
  ungrouped_share_pct: number | null;
} {
  const all = tree.total.row_count;
  const ungrouped = tree.ungrouped.length;
  const ungroupedSales = tree.ungrouped.reduce((s, l) => s + l.net_sales, 0);
  return {
    all,
    grouped: all - ungrouped,
    ungrouped,
    ungrouped_sales: round2(ungroupedSales),
    ungrouped_share_pct:
      tree.total.net_sales > 0
        ? Math.round((ungroupedSales / tree.total.net_sales) * 1000) / 10
        : null,
  };
}
