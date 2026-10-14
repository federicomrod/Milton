// R1-15b (Agrupaciones F1): the one roll-up. Synthetic fixtures only.

import { describe, expect, it } from "vitest";
import {
  buildGroupTree,
  costPctLabel,
  groupingCounts,
  largestRemainderShares,
  leavesUnder,
  marginLabel,
  rollupLeaves,
  walkTree,
  type RollupLeaf,
  type TreeGroup,
  type TreeLeaf,
  type TreeNode,
} from "@/lib/restaurant/costing/rollup";
import {
  dishSums,
  type MenuDishVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";

const leaf = (
  key: string,
  net_sales: number,
  cost_total: number | null,
  over: Partial<TreeLeaf> = {}
): TreeLeaf => ({
  key,
  ref: key,
  name: `Producto ${key}`,
  units: 10,
  net_sales,
  cost_total,
  covered: cost_total !== null,
  status: cost_total !== null ? "aprobado" : "falta_precio",
  ...over,
});

const group = (
  id: string,
  name: string,
  over: Partial<TreeGroup> = {}
): TreeGroup => ({
  id,
  name,
  parent_id: null,
  restaurant_id: null,
  source: "user",
  status: "confirmed",
  menu_dish_id: null,
  ...over,
});

describe("rollupLeaves: sums, ratio of sums, weighted coverage", () => {
  it("sums units, sales and cost", () => {
    const r = rollupLeaves([leaf("a", 100, 30), leaf("b", 300, 120)]);
    expect(r.units).toBe(20);
    expect(r.net_sales).toBe(400);
    expect(r.cost_total).toBe(150);
  });

  it("margin and cost % are ratios of sums, never an average of the children's percentages", () => {
    // a: 100 sales, 30 cost (30%); b: 300 sales, 120 cost (40%).
    const r = rollupLeaves([leaf("a", 100, 30), leaf("b", 300, 120)]);
    expect(r.food_cost_pct).toBeCloseTo(37.5, 10); // 150/400, not (30+40)/2 = 35
    expect(r.margin).toBe(250);
    expect(r.margin_pct).toBeCloseTo(62.5, 10);
  });

  it("coverage is weighted by sales; margin and cost % use only rows that have a cost", () => {
    const r = rollupLeaves([leaf("a", 600, 180), leaf("b", 400, null)]);
    expect(r.coverage).toBeCloseTo(0.6, 10);
    // Over the 600 of sales that have a cost, not over 1000.
    expect(r.cost_known_sales).toBe(600);
    expect(r.food_cost_pct).toBeCloseTo(30, 10);
    expect(r.net_sales).toBe(1000);
    expect(r.rows_without_cost).toBe(1);
    expect(r.cost_status).toBe("falta_precio");
    expect(marginLabel(r)).toBe("70% · cobertura 60%");
    expect(costPctLabel(r)).toBe("30% · cobertura 60%");
  });

  it("a row without a price is Sin precio, never $0", () => {
    const all = rollupLeaves([leaf("a", 100, null), leaf("b", 50, null)]);
    expect(all.cost_total).toBeNull();
    expect(all.margin).toBeNull();
    expect(all.margin_pct).toBeNull();
    expect(all.food_cost_pct).toBeNull();
    expect(marginLabel(all)).toBe("Sin precio");
    // A free row (confirmed $0) is a cost of 0, which is different.
    const free = rollupLeaves([leaf("w", 100, 0)]);
    expect(free.cost_total).toBe(0);
    expect(free.margin_pct).toBe(100);
  });

  it("problems are counted at the level being shown", () => {
    const r = rollupLeaves([
      leaf("a", 10, 1),
      leaf("b", 10, null),
      leaf("c", 10, null, { status: "sin_receta" }),
    ]);
    expect(r.problem_count).toBe(2);
    expect(r.row_count).toBe(3);
  });

  it("nothing sold is not a coverage of anything", () => {
    const r = rollupLeaves([]);
    expect(r.coverage).toBe(0);
    expect(r.margin_pct).toBeNull();
  });
});

describe("dishSums is the same roll-up (numbers did not move)", () => {
  // The formulas as they were before R1-15b, kept here as the reference.
  function reference(variants: readonly MenuDishVariant[]) {
    const units = variants.reduce((s, v) => s + v.units, 0);
    const net = variants.reduce((s, v) => s + v.net_sales, 0);
    const known = variants.filter((v) => v.cost_total !== null);
    const knownSales = known.reduce((s, v) => s + v.net_sales, 0);
    const costTotal = known.length
      ? known.reduce((s, v) => s + (v.cost_total ?? 0), 0)
      : null;
    const covered = variants
      .filter((v) => v.covered)
      .reduce((s, v) => s + v.net_sales, 0);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    return {
      units: r2(units),
      net_sales: r2(net),
      cost_known_sales: r2(knownSales),
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
      coverage: net > 0 ? covered / net : 0,
    };
  }

  it("matches the reference on 200 random fixtures", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 200; i++) {
      const n = 1 + Math.floor(rnd() * 8);
      const variants = Array.from({ length: n }, (_, k) => {
        const sales = Math.round(rnd() * 5000 * 100) / 100;
        const hasCost = rnd() > 0.3;
        return {
          key: `v${k}`,
          units: Math.round(rnd() * 90) / 3,
          net_sales: sales,
          cost_total: hasCost ? Math.round(rnd() * sales * 100) / 100 : null,
          covered: hasCost && rnd() > 0.4,
          status: hasCost ? "aprobado" : "falta_precio",
        } as unknown as MenuDishVariant;
      });
      const got = dishSums(variants);
      const want = reference(variants);
      expect(got).toMatchObject(want);
    }
  });
});

describe("shares add up to exactly 100", () => {
  const sum = (xs: number[]) =>
    Math.round(xs.reduce((s, x) => s + x, 0) * 10) / 10;

  it("largest remainder: thirds, ties and tiny shares", () => {
    expect(sum(largestRemainderShares([1, 1, 1]))).toBe(100);
    expect(largestRemainderShares([1, 1, 1])).toEqual([33.4, 33.3, 33.3]);
    expect(
      sum(largestRemainderShares([8.9, 8.1, 6.4, 5.2, 3.9, 3.1, 64.4]))
    ).toBe(100);
    expect(sum(largestRemainderShares([0.04, 0.03, 99.93]))).toBe(100);
    expect(largestRemainderShares([0, 0])).toEqual([0, 0]);
    expect(largestRemainderShares([])).toEqual([]);
  });

  it("holds on many random sets, with 0 and 2 decimals too", () => {
    let seed = 3;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 300; i++) {
      const values = Array.from(
        { length: 1 + Math.floor(rnd() * 12) },
        () => Math.round(rnd() * 100000) / 100
      );
      if (values.every((v) => v === 0)) continue;
      for (const d of [0, 1, 2]) {
        const shares = largestRemainderShares(values, d);
        const total = shares.reduce((s, x) => s + x, 0);
        expect(Math.round(total * 10 ** d)).toBe(100 * 10 ** d);
        expect(shares.every((x) => x >= 0)).toBe(true);
      }
    }
  });
});

describe("the tree", () => {
  // Bebidas › Refrescos › {Coca, Sprite}, Cervezas (under Bebidas), a menu
  // dish with two sizes, and an ungrouped product.
  const leaves: TreeLeaf[] = [
    leaf("coca", 500, 100),
    leaf("sprite", 300, 60),
    leaf("pilsener", 700, 280),
    leaf("churrasco6", 4000, 1400, {
      menu_dish_id: "dish-ch",
      menu_dish_name: "Churrasco Típico",
    }),
    leaf("churrasco8", 3000, 1100, {
      menu_dish_id: "dish-ch",
      menu_dish_name: "Churrasco Típico",
    }),
    leaf("varios", 120, null),
  ];
  const groups = [
    group("g-beb", "Bebidas"),
    group("g-ref", "Refrescos", { parent_id: "g-beb" }),
    group("g-cer", "Cervezas", { parent_id: "g-beb" }),
  ];
  const members = [
    { group_id: "g-ref", member_ref: "coca" },
    { group_id: "g-ref", member_ref: "sprite" },
    { group_id: "g-cer", member_ref: "pilsener" },
  ];
  const tree = buildGroupTree({ leaves, groups, members });
  const find = (name: string): TreeNode => {
    let found: TreeNode | null = null;
    walkTree(tree.top, (n) => {
      if (n.name === name && n.kind === "group") found = n;
    });
    if (!found) throw new Error(name);
    return found;
  };

  it("nests three levels deep and every level's totals equal the leaves below it", () => {
    const beb = find("Bebidas");
    const ref = find("Refrescos");
    expect(beb.children.map((c) => c.name).sort()).toEqual([
      "Cervezas",
      "Refrescos",
    ]);
    expect(ref.children.map((c) => c.leaf?.ref).sort()).toEqual([
      "coca",
      "sprite",
    ]);
    walkTree(tree.top, (n) => {
      if (n.kind !== "group") return;
      expect(n.rollup).toEqual(rollupLeaves(leavesUnder(n)));
    });
    expect(beb.rollup.net_sales).toBe(1500);
    // Ratio of sums at the top: (100+60+280) / 1500, not an average of the groups' ratios.
    expect(beb.rollup.food_cost_pct).toBeCloseTo((440 / 1500) * 100, 10);
  });

  it("a menu dish with no stored group still shows as its own level (auto), and nothing is double counted", () => {
    const dish = find("Churrasco Típico");
    expect(dish.virtual).toBe(true);
    expect(dish.rollup.net_sales).toBe(7000);
    expect(tree.total).toEqual(rollupLeaves(leaves));
    // Every leaf is in exactly one place.
    const seen: string[] = [];
    walkTree(tree.top, (n) => {
      if (n.kind === "leaf" && n.leaf) seen.push(n.leaf.key);
    });
    expect(seen.sort()).toEqual(leaves.map((l) => l.key).sort());
  });

  it("the displayed shares under every node add up to exactly 100.0", () => {
    const sum = (nodes: TreeNode[]) =>
      Math.round(nodes.reduce((s, n) => s + n.share_pct, 0) * 10) / 10;
    expect(sum(tree.top)).toBe(100);
    walkTree(tree.top, (n) => {
      if (n.kind === "group" && n.children.length > 0) {
        expect(sum(n.children)).toBe(100);
      }
    });
  });

  it("Agrupados + Sin agrupar = Todos, with the ungrouped share of sales", () => {
    const c = groupingCounts(tree);
    expect(c.all).toBe(6);
    expect(c.ungrouped).toBe(1);
    expect(c.grouped + c.ungrouped).toBe(c.all);
    expect(c.ungrouped_sales).toBe(120);
    expect(c.ungrouped_share_pct).toBeCloseTo((120 / 8620) * 100, 1);
  });

  it("an explicit choice wins over the menu dish, and it moves out of the dish (no double count)", () => {
    const moved = buildGroupTree({
      leaves,
      groups: [...groups, group("g-prem", "Premium")],
      members: [...members, { group_id: "g-prem", member_ref: "churrasco8" }],
    });
    let dish: TreeNode | null = null;
    let prem: TreeNode | null = null;
    walkTree(moved.top, (n) => {
      if (n.name === "Churrasco Típico") dish = n;
      if (n.name === "Premium") prem = n;
    });
    expect(dish!.rollup.net_sales).toBe(4000);
    expect(prem!.rollup.net_sales).toBe(3000);
    expect(moved.total.net_sales).toBe(tree.total.net_sales);
  });

  it("a stored auto group is used, and a person's rename or nesting is kept", () => {
    const stored = buildGroupTree({
      leaves,
      groups: [
        ...groups,
        group("g-parr", "Parrilla"),
        group("g-ch", "Churrasco (renombrado)", {
          source: "auto",
          menu_dish_id: "dish-ch",
          parent_id: "g-parr",
        }),
      ],
      members,
    });
    let renamed: TreeNode | null = null;
    walkTree(stored.top, (n) => {
      if (n.name === "Churrasco (renombrado)") renamed = n;
    });
    expect(renamed!.virtual).toBe(false);
    expect(renamed!.depth).toBe(1);
    expect(renamed!.rollup.net_sales).toBe(7000);
  });

  it("a suggestion does not count as a group until it is confirmed", () => {
    const withSuggestion = buildGroupTree({
      leaves,
      groups: [
        ...groups,
        group("g-s", "Sugerido", {
          source: "ai_suggested",
          status: "suggested",
        }),
      ],
      members: [...members, { group_id: "g-s", member_ref: "varios" }],
    });
    expect(withSuggestion.ungrouped.map((l) => l.key)).toEqual(["varios"]);
  });

  it("a restaurant-only group never takes another restaurant's sales", () => {
    const rows: TreeLeaf[] = [
      leaf("x-r1", 100, 30, { ref: "x", restaurant_ids: ["R1"] }),
      leaf("x-r2", 200, 60, { ref: "x", restaurant_ids: ["R2"] }),
      leaf("x-both", 50, 15, { ref: "x", restaurant_ids: ["R1", "R2"] }),
    ];
    const t = buildGroupTree({
      leaves: rows,
      groups: [group("g-r1", "Solo R1", { restaurant_id: "R1" })],
      members: [{ group_id: "g-r1", member_ref: "x" }],
    });
    let solo: TreeNode | null = null;
    walkTree(t.top, (n) => {
      if (n.name === "Solo R1") solo = n;
    });
    // Only the row that is entirely R1's; R2's and the mixed one stay on their own.
    expect(solo!.rollup.net_sales).toBe(100);
    expect(t.ungrouped.map((l) => l.key).sort()).toEqual(["x-both", "x-r2"]);
    expect(t.total.net_sales).toBe(350);
  });

  it("a restaurant's own group comes before a shared one for its sales", () => {
    const rows: TreeLeaf[] = [
      leaf("x-r1", 100, 30, { ref: "x", restaurant_ids: ["R1"] }),
    ];
    const t = buildGroupTree({
      leaves: rows,
      groups: [
        group("g-all", "Compartido"),
        group("g-r1", "Solo R1", { restaurant_id: "R1" }),
      ],
      members: [
        { group_id: "g-all", member_ref: "x" },
        { group_id: "g-r1", member_ref: "x" },
      ],
    });
    const names: string[] = [];
    walkTree(t.top, (n) => {
      if (n.kind === "group" && n.rollup.net_sales > 0) names.push(n.name);
    });
    expect(names).toEqual(["Solo R1"]);
  });
});
