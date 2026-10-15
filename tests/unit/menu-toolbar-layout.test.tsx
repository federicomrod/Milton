// @vitest-environment jsdom
// Menú › Ingredientes and Preparaciones: ONE full-width toolbar above the list and
// the detail (search, «Milton sugiere», Todos / Agrupados / Sin agrupar, filters,
// sort); the left column holds only the rows. No restaurant tags in chips or rows;
// suggestions never mix restaurants; a plain price field. Made-up data only.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, refresh() {}, replace() {} }),
  usePathname: () => "/dashboard/restaurant/menu/ingredientes",
  useSearchParams: () => new URLSearchParams(),
}));

import {
  IngredientesScreen,
  type IngredienteItem,
} from "@/components/restaurant/menu/IngredientesScreen";
import { PreparacionesScreen } from "@/components/restaurant/recipes-costing/PreparacionesScreen";
import { clusterSuggestions } from "@/lib/restaurant/groups/cluster-suggest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) }))
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ing = (
  id: string,
  name: string,
  over: Partial<IngredienteItem> = {}
): IngredienteItem => ({
  id,
  name,
  category: null,
  default_unit: "lb",
  price: 2.5,
  price_unit: "lb",
  price_date: "2026-07-01",
  price_entry_id: `e${id}`,
  recipeCount: 2,
  lineCount: 2,
  previous_price: null,
  source: "lista",
  supplier_id: null,
  supplier_name: "Proveedor de prueba",
  inUse: true,
  archived: false,
  sold_net_sales: 100,
  uses: [],
  ...over,
});
const ITEMS: IngredienteItem[] = [
  ing("1", "Queso fresco", {
    price: null,
    price_unit: null,
    price_date: null,
    price_entry_id: null,
  }),
  ing("2", "Queso crema"),
  ing("3", "Queso seco"),
  ing("4", "Queso mozzarella"),
  ing("5", "Tomate rojo"),
  ing("6", "Tomate rojos"),
  ing("7", "Cebolla blanca"),
  ing(
    "8",
    "Sal fina de prueba con un nombre larguísimo que no cabe en una sola línea del panel"
  ),
];
const NO_GROUPS = { available: true, groups: [], members: [] };

function ingredientes() {
  return render(
    <IngredientesScreen
      items={ITEMS}
      suppliers={[]}
      currency="USD"
      initialSelectedId="1"
      initialFilter="todos"
      itemGroups={NO_GROUPS as never}
      archiveAvailable
      duplicates={{
        available: true,
        stored: [],
        notDuplicates: [],
        merges: [],
      }}
    />
  );
}
const prepRows = [
  ["c1", "Salsa roja"],
  ["c2", "Salsa verde"],
  ["c3", "Salsa de chile"],
  ["c4", "Salsa criolla"],
  ["c5", "Aderezo de la casa"],
].map(([component_id, name]) => ({
  component_id,
  name,
  status: "borrador" as const,
  open_note: null,
  yield_to_confirm: false,
  impact: { dishes: 2, net_sales: 100 },
  impact_label: "Desbloquea 2 platos",
}));
function preparaciones() {
  return render(
    <PreparacionesScreen
      data={
        {
          preparations_overview: { rows: prepRows, drafts: 5, approved: 0 },
          item_groups: NO_GROUPS,
          actor: { can_submit: true, can_approve: true },
        } as never
      }
      selectedId={null}
      onSelect={() => {}}
    />
  );
}

const SCREENS: Array<[string, () => ReturnType<typeof render>, string]> = [
  ["Ingredientes", ingredientes, "Buscar ingrediente o grupo…"],
  ["Preparaciones", preparaciones, "Buscar preparación o grupo…"],
];

describe.each(SCREENS)(
  "%s: the toolbar is full width, the list column only has rows",
  (_name, draw, placeholder) => {
    it("search, «Milton sugiere» and the Agrupados tabs are in the toolbar, NOT in the list column", async () => {
      draw();
      const toolbar = await screen.findByTestId("menu-toolbar");
      const column = screen.getByTestId("list-column");
      // search
      const search = screen.getByRole("searchbox", { name: placeholder });
      expect(toolbar.contains(search)).toBe(true);
      expect(column.contains(search)).toBe(false);
      // Milton sugiere
      const milton = screen.getByTestId("milton-suggestions");
      expect(toolbar.contains(milton)).toBe(true);
      expect(column.contains(milton)).toBe(false);
      expect(within(milton).getByText(/Milton sugiere/)).toBeTruthy();
      // Todos / Agrupados / Sin agrupar
      for (const tab of [/^Agrupados/, /^Sin agrupar/]) {
        const el = within(toolbar).getByRole("button", { name: tab });
        expect(column.contains(el)).toBe(false);
      }
      expect(
        within(column).queryByRole("button", { name: /^Agrupados/ })
      ).toBeNull();
      // sort chips
      expect(within(toolbar).getByText("Ordenar:")).toBeTruthy();
      expect(within(column).queryByText("Ordenar:")).toBeNull();
      // the rows ARE in the column
      expect(within(column).getAllByRole("button").length).toBeGreaterThan(0);
      // the toolbar is not a descendant of the column, nor the column of the toolbar
      expect(column.contains(toolbar)).toBe(false);
      expect(toolbar.contains(column)).toBe(false);
    });

    it("the list column scrolls on its own and the grid fits a laptop (min-w-0, no fixed 330px)", () => {
      draw();
      const column = screen.getByTestId("list-column");
      expect(column.className).toMatch(/overflow-y-auto/);
      const grid = column.closest("div.grid") as HTMLElement;
      expect(grid.className).toMatch(/minmax\(300px,360px\)/);
      expect(grid.className).not.toMatch(/\[330px_1fr\]/);
      expect(grid.className).toMatch(/minmax\(0,1fr\)|grid-cols-1/);
    });

    it("no restaurant tag in chips or rows", () => {
      draw();
      const toolbar = screen.getByTestId("menu-toolbar");
      const column = screen.getByTestId("list-column");
      for (const area of [toolbar, column]) {
        expect(area.textContent).not.toMatch(
          /Stage Test|Los Ranchos|\bR1\b|\bR2\b|Restaurante \d/
        );
      }
    });
  }
);

describe("Ingredientes: duplicates banner, rows and the price field", () => {
  it("the duplicates banner is full width above the toolbar, compact, and its cards can shrink", async () => {
    ingredientes();
    const banner = await screen.findByTestId("duplicates-banner");
    const toolbar = screen.getByTestId("menu-toolbar");
    expect(
      banner.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(banner.closest("div.grid")).toBeNull(); // not inside the narrow list/detail grid
    const html = banner.outerHTML;
    expect(html).not.toContain("min-w-[200px]");
    expect(html).toMatch(/min-w-0/);
  });
  it("long names wrap to two lines with the full name in title (rows), the supplier on its own line", () => {
    ingredientes();
    const column = screen.getByTestId("list-column");
    const long = ITEMS[7].name;
    const row = within(column).getByTitle(long);
    expect(row.innerHTML).toMatch(/line-clamp-2/);
    expect(row.innerHTML).toMatch(/break-words/);
    expect(row.textContent).toContain("Proveedor de prueba");
  });
  it("the price field is a normal input: «Falta precio» placeholder, no 30px text, no big red", async () => {
    ingredientes();
    const price = (await screen.findByLabelText(
      "Precio actual"
    )) as HTMLInputElement;
    expect(price.placeholder).toBe("Falta precio");
    expect(price.className).not.toMatch(/text-\[30px\]/);
    expect(price.className).toMatch(/text-\[15px\]/);
    expect(price.className).toMatch(/w-\[180px\]/);
    expect(price.className).toMatch(/border-\[#c6d3f5\]/);
    expect(price.className).not.toMatch(/#d14343/);
    expect(price.value).toBe(""); // no price: empty, never $0
    expect(price.value).not.toMatch(/0/);
  });
  it("the list shows «Falta precio» for an in-use ingredient with no price, in a calm tone (not red)", () => {
    ingredientes();
    const column = screen.getByTestId("list-column");
    const tag = within(column).getByText("Falta precio");
    expect(tag.getAttribute("style") ?? "").not.toMatch(
      /d14343|rgb\(209, 67, 67\)/
    );
    expect(column.textContent).not.toMatch(/\$0(?![.,\d])/);
  });
});

describe("Preparaciones: names and layout", () => {
  it("the left card only has the title and the rows (the counts moved to the toolbar)", async () => {
    preparaciones();
    const toolbar = await screen.findByTestId("menu-toolbar");
    expect(within(toolbar).getByText("5 por aprobar")).toBeTruthy();
    const column = screen.getByTestId("list-column");
    expect(within(column).queryByText("5 por aprobar")).toBeNull();
    expect(within(column).getByTitle("Salsa roja")).toBeTruthy();
  });
});

describe("suggestions never mix restaurants, and there is no restaurant tag in the chips", () => {
  const items = [
    ...[
      "Cerveza clara",
      "Cerveza oscura",
      "Cerveza roja",
      "Cerveza dorada",
    ].map((name, i) => ({ ref: `a${i}`, name, restaurant: "rest-a" })),
    ...["Cerveza ligera", "Cerveza negra", "Cerveza mixta", "Cerveza fría"].map(
      (name, i) => ({ ref: `b${i}`, name, restaurant: "rest-b" })
    ),
    ...["Postre uno", "Postre dos", "Postre tres"].map((name, i) => ({
      ref: `c${i}`,
      name,
      restaurant: null,
    })),
    ...["Otro", "Algo", "Más", "Extra"].map((name, i) => ({
      ref: `x${i}`,
      name,
      restaurant: "rest-a",
    })),
    ...["Uno", "Dos", "Tres", "Cuatro"].map((name, i) => ({
      ref: `y${i}`,
      name,
      restaurant: "rest-b",
    })),
  ];
  it("under «Todos los restaurantes» (per restaurant) no cluster holds items of two restaurants", () => {
    const byRef = new Map(items.map((i) => [i.ref, i.restaurant]));
    const clusters = clusterSuggestions(items, {
      perRestaurant: true,
      takenFor: () => new Set(),
    });
    expect(clusters.length).toBeGreaterThanOrEqual(2);
    for (const c of clusters) {
      const restaurants = new Set(c.refs.map((r) => byRef.get(r)));
      expect(restaurants.size, c.name).toBe(1);
      expect(c.restaurantId ?? null).toBe([...restaurants][0] ?? null);
    }
    // the same names in two restaurants give two suggestions, one per restaurant
    expect(
      clusters
        .filter((c) => /cerveza/i.test(c.name))
        .map((c) => c.restaurantId)
        .sort()
    ).toEqual(["rest-a", "rest-b"]);
  });
  it("the Milton chips no longer take or draw a restaurant tag (the restaurant is chosen in the top selector)", () => {
    const src = read("components/restaurant/groups/MiltonSuggestions.tsx");
    expect(src).not.toMatch(/restaurantTag|tag=/);
    expect(
      read("components/restaurant/groups/ProductosView.tsx")
    ).not.toContain("restaurantTag");
    // the per-restaurant clustering itself stays
    expect(
      read("components/restaurant/groups/use-milton-suggestions.ts")
    ).toContain("perRestaurant");
    expect(read("components/restaurant/groups/ProductosView.tsx")).toContain(
      "perRestaurant"
    );
  });
});
