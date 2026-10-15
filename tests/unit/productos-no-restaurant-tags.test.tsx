// @vitest-environment jsdom
// Menú › Productos under «Todos los restaurantes»: rows and group rows carry NO
// restaurant tag (the restaurant is the top selector); the real name shows only in
// the detail pane; suggestions never mix restaurants. Made-up names only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToString } from "react-dom/server";
import { createElement } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/platos",
  useSearchParams: () => new URLSearchParams(),
}));

import { ProductosView } from "@/components/restaurant/groups/ProductosView";
import { useItemGroups } from "@/components/restaurant/groups/use-item-groups";
import { DrillView } from "@/components/restaurant/menu/DrillView";
import { clusterSuggestions } from "@/lib/restaurant/groups/cluster-suggest";
import type {
  MenuDish,
  MenuDishVariant,
} from "@/lib/restaurant/menu-dishes/menu-dishes";

afterEach(cleanup);

const RESTAURANTS = [
  { id: "ra", name: "Casa Norte" },
  { id: "rb", name: "Casa Sur" },
];

let n = 0;
function variant(name: string, restaurant: string): MenuDishVariant {
  n += 1;
  return {
    odoo_product_id: n,
    key: `k${n}`,
    sales_scope: null,
    sale_location_ids: [restaurant],
    saved: true,
    name,
    size: null,
    size_unit: null,
    side: null,
    sides: [],
    cooking_point: null,
    channel: "salón",
    is_promo: false,
    units: 1,
    net_sales: 100,
    unit_cost: null,
    cost_total: 40,
    margin: null,
    food_cost_pct: null,
    cost_basis: null,
    status: "aprobado",
    covered: true,
  } as MenuDishVariant;
}
function dish(id: string, v: MenuDishVariant): MenuDish {
  return {
    id,
    stored: true,
    name: v.name,
    category: null,
    source: "name",
    status: "aprobado",
    excluded_reason: null,
    variants: [v],
    units: 1,
    net_sales: 100,
    share_of_food_sales: 0.1,
    cost_known_sales: 100,
    cost_total: 40,
    food_cost_pct: 40,
    margin: 60,
    margin_pct: 60,
    coverage: 1,
    cost_status: "aprobado",
    base_odoo_product_id: null,
    base_portion_qty: null,
    excel_total: null,
    excel_diff_flag: false,
  } as unknown as MenuDish;
}
const NAMES_A = [
  "Cerveza clara",
  "Cerveza oscura",
  "Cerveza roja",
  "Cerveza dorada",
  "Pollo",
  "Arroz",
  "Flan",
];
const NAMES_B = [
  "Cerveza ligera",
  "Cerveza negra",
  "Cerveza mixta",
  "Cerveza fría",
  "Sopa",
  "Pasta",
  "Helado",
];
const DISHES: MenuDish[] = [
  ...NAMES_A.map((nm, i) => dish(`da${i}`, variant(nm, "ra"))),
  ...NAMES_B.map((nm, i) => dish(`db${i}`, variant(nm, "rb"))),
];

const GROUPS_INITIAL = {
  available: true,
  groups: [
    {
      id: "g1",
      name: "Bebidas norte",
      scope: "product",
      parent_id: null,
      restaurant_id: "ra",
      source: "manual",
    },
  ],
  members: [
    {
      group_id: "g1",
      item_ref: String(DISHES[0].variants[0].odoo_product_id),
    },
  ],
} as never;

const EXCLUDED: MenuDish[] = [];

function Harness({ viewLocationId }: { viewLocationId: string | null }) {
  const grouping = useItemGroups(GROUPS_INITIAL);
  return (
    <ProductosView
      dishes={DISHES}
      excluded={EXCLUDED}
      grouping={grouping}
      canEdit
      money={(x) => `$${x}`}
      onAddToDish={() => {}}
      onDrillDish={() => {}}
      onDrillGroup={() => {}}
      onOpenRecipe={() => {}}
      restaurants={RESTAURANTS}
      viewLocationId={viewLocationId}
    />
  );
}

describe("Productos under Todos los restaurantes", () => {
  it("group rows, product rows and Milton chips carry no restaurant name", () => {
    const { container } = render(<Harness viewLocationId={null} />);
    // «Todos»: the group (dish) rows
    const groupRows = container.querySelectorAll("tbody tr");
    expect(groupRows.length).toBeGreaterThan(5);
    for (const g of groupRows)
      expect(g.textContent).not.toMatch(/Casa Norte|Casa Sur/);
    // open every group: the product rows
    for (const b of screen.getAllByRole("button", { name: "Abrir grupo" }))
      fireEvent.click(b);
    const rows = screen.getAllByTestId("producto-row");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows)
      expect(r.textContent).not.toMatch(/Casa Norte|Casa Sur/);
    const milton = screen.queryByTestId("milton-suggestions");
    if (milton) expect(milton.textContent).not.toMatch(/Casa Norte|Casa Sur/);
    expect(container.textContent).toContain("Cerveza clara");
  });
  it("suggestions never mix restaurants: one «Cerveza» suggestion per restaurant", () => {
    const items = DISHES.map((d) => ({
      ref: d.id,
      name: d.name,
      restaurant: d.variants[0].sale_location_ids?.[0] ?? null,
    }));
    const byRef = new Map(items.map((i) => [i.ref, i.restaurant]));
    const clusters = clusterSuggestions(items, {
      perRestaurant: true,
      takenFor: () => new Set(),
    });
    for (const c of clusters)
      expect(new Set(c.refs.map((r) => byRef.get(r))).size, c.name).toBe(1);
    expect(
      clusters
        .filter((c) => /cerveza/i.test(c.name))
        .map((c) => c.restaurantId)
        .sort()
    ).toEqual(["ra", "rb"]);
  });
  it("the grouping logic still scopes by restaurant (perRestaurant stays on)", () => {
    const src = readFileSync(
      join(process.cwd(), "components/restaurant/groups/ProductosView.tsx"),
      "utf8"
    );
    expect(src).toContain("perRestaurant: multi");
    expect(src).not.toMatch(/tagOf=\{/);
  });
});

describe("the detail pane names the restaurant", () => {
  const grouping: any = {
    available: true,
    state: { groups: [], members: [] },
    run: async () => true,
    created: null,
    toast: null,
    dismissToast() {},
    notify() {},
  };
  const draw = (ids: string[], showRestaurants = true) =>
    renderToString(
      createElement(DrillView, {
        title: "Churrasco",
        scopeId: "d1",
        menuSales: 1000,
        grouping,
        canEdit: true,
        money: (x: number) => `$${x}`,
        onBack() {},
        restaurants: RESTAURANTS,
        showRestaurants,
        variants: [
          variant("A", ids[0]),
          ...(ids[1] ? [variant("B", ids[1])] : []),
        ],
      })
    ).replace(/<!-- -->/g, "");
  it("«Restaurante: <nombre>» under Todos", () => {
    const html = draw(["ra"]);
    expect(html).toContain("Restaurante:");
    expect(html).toContain("Casa Norte");
  });
  it("«Restaurantes: A · B» when it sells in both", () => {
    expect(draw(["ra", "rb"])).toContain("Casa Norte · Casa Sur");
  });
  it("nothing when one restaurant is selected", () => {
    expect(draw(["ra"], false)).not.toContain("Restaurante:");
  });
});
