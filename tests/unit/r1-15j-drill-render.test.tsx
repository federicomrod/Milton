// R1-15j: the Desglose must draw for ANY dish or group, including the ones
// with a single variant, no size/side/point, no price or no sales (it used to
// throw «Cannot read properties of undefined (reading 'stored')»). Synthetic.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DrillView } from "@/components/restaurant/menu/DrillView";
import { RowActions } from "@/components/restaurant/groups/RowActions";
import { DrillErrorBoundary } from "@/components/restaurant/menu/DrillErrorBoundary";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";

let n = 0;
function v(
  name: string,
  net_sales: number,
  cost_total: number | null,
  over: Partial<MenuDishVariant> = {}
): MenuDishVariant {
  n += 1;
  return {
    odoo_product_id: n,
    key: `k${n}`,
    sales_scope: null,
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
    net_sales,
    unit_cost: null,
    cost_total,
    margin: null,
    food_cost_pct: null,
    cost_basis: null,
    status: cost_total === null ? "falta_precio" : "aprobado",
    covered: cost_total !== null,
    ...over,
  };
}
const grouping: any = {
  available: true,
  state: { groups: [], members: [] },
  run: async () => true,
  created: null,
  toast: null,
  dismissToast() {},
  notify() {},
};
const draw = (
  title: string,
  variants: MenuDishVariant[],
  scopeId: string | null
) =>
  renderToString(
    createElement(DrillView, {
      title,
      variants,
      scopeId,
      menuSales: 1000,
      grouping,
      canEdit: true,
      money: (x: number) => `$${x}`,
      onBack() {},
    })
  );

describe("Desglose draws for every kind of dish and group", () => {
  const cases: Array<[string, MenuDishVariant[], string | null]> = [
    ["one variant, nothing to split by", [v("Ensalada", 100, 30)], "d1"],
    ["one variant with no price", [v("Ensalada", 100, null)], "d1"],
    [
      "no sales at all",
      [v("Ensalada", 0, null), v("Ensalada 2", 0, null)],
      "d1",
    ],
    ["an empty group", [], null],
    ["a group of one product", [v("Mojito", 50, 10)], null],
    [
      "a group of drinks (no size/side/point)",
      [v("Mojito", 50, 10), v("Cuba", 70, 20)],
      null,
    ],
    [
      "a dish with only a size",
      [
        v("A", 10, 1, { size: 6, size_unit: "oz" }),
        v("B", 10, 1, { size: 8, size_unit: "oz" }),
      ],
      "d1",
    ],
    ["a dish with events only", [v("A", 10, 1, { channel: "eventos" })], "d1"],
    ["an unsaved Milton dish", [v("A", 10, 1)], "auto:abc"],
    ["negative or odd numbers", [v("A", -5, 2), v("B", 10, -1)], "d1"],
  ];
  for (const [label, variants, scope] of cases) {
    it(`draws: ${label}`, () => {
      expect(() => draw("X", variants, scope)).not.toThrow();
    });
  }
  it("a group of drinks opens by Producto", () => {
    const html = draw(
      "Cocktails",
      [v("Mojito", 50, 10), v("Cuba", 70, 20)],
      null
    );
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("Ventas por producto");
    expect(text).not.toContain("Punto");
  });
  it("a Desglose that really breaks shows a friendly message, not a crash", () => {
    // React's server renderer does not run boundaries: check the two halves.
    expect(DrillErrorBoundary.getDerivedStateFromError()).toEqual({
      failed: true,
    });
    class Failed extends DrillErrorBoundary {
      state = { failed: true };
    }
    const html = renderToString(
      createElement(Failed, { title: "Plato roto", onBack() {} }, null)
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("No pude mostrar el desglose de «Plato roto»");
    expect(html).toContain("Volver a Platos");
  });

  it("under Todos it says where the dish sells, by real name, and offers the split by restaurant", () => {
    const restaurants = [
      { id: "r1", name: "Casa Norte" },
      { id: "r2", name: "Casa Sur" },
    ];
    const html = renderToString(
      createElement(DrillView, {
        title: "Churrasco",
        scopeId: "d1",
        menuSales: 1000,
        grouping,
        canEdit: true,
        money: (x: number) => `$${x}`,
        onBack() {},
        restaurants,
        showRestaurants: true,
        variants: [
          v("A", 10, 1, { sale_location_ids: ["r1"] }),
          v("B", 10, 1, { sale_location_ids: ["r2"] }),
          v("C", 10, 1, { sale_location_ids: ["r1", "r2"] }),
        ],
      })
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Casa Norte · Casa Sur");
    expect(html).toContain("Restaurante");
    expect(html).toContain("Ambos restaurantes");
    expect(html).not.toContain("R1");
  });
  it("shows nothing about restaurants when one restaurant is selected", () => {
    const html = renderToString(
      createElement(DrillView, {
        title: "Churrasco",
        scopeId: "d1",
        menuSales: 1000,
        grouping,
        canEdit: true,
        money: (x: number) => `$${x}`,
        onBack() {},
        showRestaurants: false,
        variants: [v("A", 10, 1, { sale_location_ids: ["r1"] })],
      })
    );
    expect(html).not.toContain("Se vende en");
  });
  it("has a way back to the list it came from", () => {
    const html = renderToString(
      createElement(DrillView, {
        title: "X",
        scopeId: "d1",
        menuSales: 1,
        grouping,
        canEdit: true,
        money: (x: number) => `$${x}`,
        onBack() {},
        backLabel: "Productos",
        variants: [v("A", 10, 1)],
      })
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("← Volver a Productos");
  });
});

describe("row actions: hover anywhere on the row, always on touch and keyboard focus", () => {
  it("are soft chips tied to the row's hover, focus and touch", () => {
    const html = renderToString(
      createElement(RowActions, { onDrill() {}, onRecipe() {} })
    );
    expect(html).toContain("group-hover/row:opacity-100");
    expect(html).toContain("focus-within:opacity-100");
    expect(html).toContain("[@media(hover:none)]:opacity-100");
    expect(html).toContain("Desglose");
    expect(html).toContain("Receta");
    expect(html).not.toContain("bg-[#1b40c8] px-2");
  });
});
