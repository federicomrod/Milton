// @vitest-environment jsdom
// Part D: a size row opens into its Odoo products. Each product has its own
// chip, «Abrir», and (if it has no recipe of its own) «Usar la receta de
// {hermano}» with a confirm. The «Aprobado N de M» tooltip names the missing
// products. Synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MenuDishesScreen } from "@/components/restaurant/menu/MenuDishesScreen";
import {
  missingProductsTip,
  pickApprovedSibling,
  productsOf,
} from "@/lib/restaurant/menu-dishes/size-products";
import type { MenuDishVariant } from "@/lib/restaurant/menu-dishes/menu-dishes";
import type { RecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, refresh: () => undefined }),
}));

function variant(over: Partial<MenuDishVariant>): MenuDishVariant {
  return {
    odoo_product_id: 1,
    key: String(over.odoo_product_id ?? 1),
    sales_scope: null,
    saved: true,
    name: "Parrillada Demo 6 oz",
    size: 6,
    size_unit: "oz",
    side: null,
    sides: [],
    cooking_point: null,
    channel: "salón",
    is_promo: false,
    units: 10,
    net_sales: 100,
    unit_cost: 4,
    cost_total: 40,
    margin: 60,
    food_cost_pct: 40,
    cost_basis: "own",
    status: "aprobado",
    covered: true,
    menu_item_id: "m-" + (over.odoo_product_id ?? 1),
    ...over,
  };
}

const V6 = variant({ odoo_product_id: 1, net_sales: 300 });
const V6_PLUS = variant({
  odoo_product_id: 2,
  name: "Parrillada Demo 6 oz Plus",
  net_sales: 50,
  status: "aprobado",
});
const V6_EVENTOS = variant({
  odoo_product_id: 3,
  name: "Parrillada Demo 6 oz Eventos",
  net_sales: 80,
  unit_cost: null,
  cost_total: null,
  margin: null,
  food_cost_pct: null,
  cost_basis: null,
  status: "sin_receta",
  covered: false,
  menu_item_id: "m-3",
});
const V10 = variant({
  odoo_product_id: 4,
  name: "Parrillada Demo 10 oz",
  size: 10,
  net_sales: 200,
});
const V10_DRAFT = variant({
  odoo_product_id: 5,
  name: "Parrillada Demo 10 oz Eventos",
  size: 10,
  net_sales: 20,
  unit_cost: null,
  cost_total: null,
  margin: null,
  food_cost_pct: null,
  cost_basis: null,
  status: "borrador" as MenuDishVariant["status"],
  covered: false,
  menu_item_id: "m-5",
});

function workspace(
  variants: MenuDishVariant[],
  capabilities: Record<string, boolean> = { "links.confirm": true }
): RecipeCostingWorkspace {
  const approved = variants.filter((v) => v.status === "aprobado").length;
  const dish = {
    id: "d1",
    stored: true,
    name: "Parrillada Demo",
    category: null,
    source: "menu",
    status: "confirmed",
    excluded_reason: null,
    variants,
    units: 10,
    net_sales: variants.reduce((s, v) => s + v.net_sales, 0),
    share_of_food_sales: 1,
    cost_known_sales: 0,
    cost_total: null,
    food_cost_pct: null,
    margin: null,
    margin_pct: null,
    coverage: 0.5,
    cost_status: approved === variants.length ? "aprobado" : "sin_receta",
    approved_count: approved,
    variant_count: variants.length,
    base_odoo_product_id: 1,
    base_menu_item_id: "m-1",
    base_portion_qty: 6,
    excel_total: null,
    excel_diff_flag: false,
  };
  return {
    currency: "USD",
    period_label: null,
    view_location_id: null,
    actor: { can_submit: true, capabilities },
    item_groups: null,
    restaurants: [],
    menu_dishes: {
      dishes: [dish],
      excluded: [],
      stored: true,
      unsaved_variant_count: 0,
      variant_count: variants.length,
      excluded_variant_count: 0,
      kpis: {
        food_cost_pct: null,
        gross_margin: null,
        coverage_pct: 0,
        covered_dishes: 0,
        partial_dishes: 0,
        dish_count: 1,
        problem_count: 1,
        missing_price_dishes: 0,
        no_recipe_dishes: 1,
      },
    },
  } as unknown as RecipeCostingWorkspace;
}

function mount(ws: RecipeCostingWorkspace, onEstimated = vi.fn()) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ available: false, eligible: 0 }))
      )
    )
  );
  render(
    <MenuDishesScreen
      data={ws}
      onOpenDish={() => undefined}
      estimates={[]}
      onEstimated={onEstimated}
    />
  );
  return onEstimated;
}

function openSize(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Ver variantes" }));
  const row = screen.getByText(new RegExp(`^${label} ·`)).closest("tr")!;
  fireEvent.click(within(row).getByRole("button", { name: "Ver productos" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sibling choice (pure)", () => {
  const all = [V6, V6_PLUS, V6_EVENTOS, V10, V10_DRAFT];
  it("prefers the same size, then the best seller", () => {
    expect(pickApprovedSibling(all, productsOf([V6_EVENTOS])[0])?.name).toBe(
      "Parrillada Demo 6 oz"
    );
    expect(pickApprovedSibling(all, productsOf([V10_DRAFT])[0])?.name).toBe(
      "Parrillada Demo 10 oz"
    );
    // no approved product of the same size: the best seller of the dish
    expect(
      pickApprovedSibling([V6, V10_DRAFT], productsOf([V10_DRAFT])[0])?.name
    ).toBe("Parrillada Demo 6 oz");
  });
  it("is null when the dish has no approved sibling", () => {
    expect(
      pickApprovedSibling([V6_EVENTOS, V10_DRAFT], productsOf([V6_EVENTOS])[0])
    ).toBeNull();
  });
  it("lists the missing products with their status", () => {
    expect(missingProductsTip(all)).toBe(
      "Faltan: Parrillada Demo 6 oz Eventos (Sin receta), Parrillada Demo 10 oz Eventos (Borrador)"
    );
    expect(missingProductsTip([V6, V10])).toBeNull();
  });
});

describe("MenuDishesScreen · size rows open into products", () => {
  beforeEach(() => cleanup());

  it("shows each Odoo product with its chip and an «Abrir» to its plato page", () => {
    mount(workspace([V6, V6_PLUS, V6_EVENTOS, V10]));
    openSize("6 oz");
    const rows = screen.getAllByTestId("size-product-row");
    expect(rows).toHaveLength(3);
    const eventos = rows.find((r) => r.textContent?.includes("6 oz Eventos"))!;
    expect(within(eventos).getByText("Sin receta")).toBeTruthy();
    expect(
      within(eventos).getByRole("link", { name: /Abrir/ }).getAttribute("href")
    ).toBe("/dashboard/restaurant/menu/platos?producto=3");
    // the 10 oz size stays closed
    expect(screen.queryByText("Parrillada Demo 10 oz")).toBeNull();
  });

  it("prefills «Usar la receta de {hermano}» with the same-size approved product and confirms before linking", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const onChanged = mount(workspace([V6, V6_PLUS, V6_EVENTOS, V10]));
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === "POST") {
          calls.push({ url, body: JSON.parse(String(init.body)) });
        }
        return Promise.resolve(new Response(JSON.stringify({ link: {} })));
      })
    );
    openSize("6 oz");
    const eventos = screen
      .getAllByTestId("size-product-row")
      .find((r) => r.textContent?.includes("6 oz Eventos"))!;
    // the approved products only offer «Abrir»
    for (const row of screen.getAllByTestId("size-product-row")) {
      if (row !== eventos) {
        expect(within(row).queryByText(/Usar la receta de/)).toBeNull();
      }
    }
    fireEvent.click(
      within(eventos).getByRole("button", {
        name: "Usar la receta de Parrillada Demo 6 oz",
      })
    );
    // nothing is saved until the person confirms
    expect(calls).toHaveLength(0);
    expect(
      within(eventos).getByText(
        "Parrillada Demo 6 oz Eventos usará la receta de Parrillada Demo 6 oz. Comparten la misma receta."
      )
    ).toBeTruthy();
    fireEvent.click(within(eventos).getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/restaurant/pos/links/change");
    expect(calls[0].body).toEqual({
      odoo_product_id: 3,
      odoo_name: "Parrillada Demo 6 oz Eventos",
      menu_item_id: "m-1",
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("a Borrador product of another size uses the best approved sibling of that size", () => {
    mount(workspace([V6, V10, V10_DRAFT]));
    openSize("10 oz");
    expect(
      screen.getByRole("button", {
        name: "Usar la receta de Parrillada Demo 10 oz",
      })
    ).toBeTruthy();
  });

  it("hides the button when the dish has no approved sibling, or the role cannot link", () => {
    mount(workspace([V6_EVENTOS, V10_DRAFT]));
    openSize("6 oz");
    expect(screen.queryByText(/Usar la receta de/)).toBeNull();
    cleanup();
    mount(workspace([V6, V6_EVENTOS], { "recipes.edit": true }));
    openSize("6 oz");
    expect(screen.queryByText(/Usar la receta de/)).toBeNull();
    // «Abrir» is always there
    expect(screen.getAllByRole("link", { name: /Abrir/ })).toHaveLength(2);
  });

  it("the «Aprobado N de M» chip tooltip names the products that are missing", () => {
    mount(workspace([V6, V6_PLUS, V6_EVENTOS, V10, V10_DRAFT]));
    const chip = screen.getByText("Aprobado 3 de 5");
    const tip = chip.closest("span[title]")!.getAttribute("title")!;
    expect(tip).toContain(
      "Faltan: Parrillada Demo 6 oz Eventos (Sin receta), Parrillada Demo 10 oz Eventos (Borrador)"
    );
  });
});
