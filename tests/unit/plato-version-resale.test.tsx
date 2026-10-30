// @vitest-environment jsdom
// Item 4/5/7: one version pick for the screen and the engine; a legacy line
// copy is never a price; the Reventa inline price; the Excel comparison is gray.
// Synthetic names and prices only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { CostingData } from "@/lib/restaurant/costing";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import {
  dishHasRecipe,
  pickDishVersion,
  resolveDishMenuItemId,
} from "@/lib/restaurant/costing/dish-version";
import { evidenceLinesOf } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  latestPrice,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import { KITCHEN_UNITS } from "@/lib/restaurant/kitchen-units";
import { TreatmentControl } from "@/components/restaurant/recipes-costing/TreatmentPanel";
import { clearIngredientOptionsCache } from "@/components/restaurant/recipes-costing/ingredient-options";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CO = "co-1";

function link(
  productId: number,
  over: Partial<PosProductLinkRecord> = {}
): PosProductLinkRecord {
  return {
    company_id: CO,
    location_id: null,
    odoo_product_id: productId,
    odoo_name: `P${productId}`,
    classification: "reventa",
    menu_item_id: null,
    link_state: "confirmado",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
    ...over,
  };
}

function econ(opts: {
  links: PosProductLinkRecord[];
  versions: DishVersion[];
  inputs: Map<string, VersionInput[]>;
  sales: Array<[number, string]>;
}) {
  const data: CostingData = {
    ingredientsById: new Map([
      ["i-beb", { id: "i-beb", name: "BEBIDA", default_unit: "unidad" }],
    ]),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(), // BEBIDA has no price
  };
  const sales = opts.sales.map(([id, name]) => ({
    company_id: CO,
    raw_item_name: name,
    quantity: 10,
    gross_revenue: 20,
    net_revenue: 20,
    source_metadata: { product_id: id },
  }));
  const list = buildPosProductList({
    companyId: CO,
    sales,
    links: opts.links,
    recipeVersions: opts.versions.map((v) => ({
      menu_item_id: v.menu_item_id,
      status: v.status,
    })),
  });
  return buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links: opts.links,
    versions: opts.versions,
    inputsByVersionId: opts.inputs,
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
}

const legacyLine: VersionInput = {
  id: "l1",
  input_type: "ingredient",
  ingredient_id: "i-beb",
  component_id: null,
  quantity: 1,
  unit: "unidad",
  unit_cost: 4.15, // copied from the Excel
  cost_source: "SODAS!E8",
};
const ver = (over: Partial<DishVersion>): DishVersion => ({
  id: "v1",
  menu_item_id: "m1",
  version_number: 1,
  status: "in_review",
  effective_date: null,
  created_at: "2026-10-02T10:00:00Z",
  ...over,
});

describe("shared version pick (dish-version.ts)", () => {
  it("takes the recipe id from the product or, failing that, the link", () => {
    expect(resolveDishMenuItemId("a", "b")).toBe("a");
    expect(resolveDishMenuItemId(null, "b")).toBe("b");
    expect(resolveDishMenuItemId(null, null)).toBeNull();
  });

  it("picks the approved version in force, else the newest of any status", () => {
    const map = new Map([
      [
        "m1",
        [
          ver({ id: "a", version_number: 1, status: "approved" }),
          ver({ id: "b", version_number: 2, status: "in_review" }),
        ],
      ],
      ["m2", [ver({ id: "c", menu_item_id: "m2", version_number: 3 })]],
    ]);
    expect(
      pickDishVersion({
        productMenuItemId: null,
        linkMenuItemId: "m1",
        versionsByMenuItem: map,
      }).version?.id
    ).toBe("a");
    expect(
      pickDishVersion({
        productMenuItemId: "m2",
        versionsByMenuItem: map,
      }).version?.id
    ).toBe("c");
  });

  it("empty state only for no recipe or no version; an empty version still opens the editor (no duplicate «Crear receta»)", () => {
    const base = { menuItemId: "m1", versionId: "v1" };
    expect(dishHasRecipe({ ...base, lineCount: 2, evidenceLineCount: 0 })).toBe(
      true
    );
    expect(dishHasRecipe({ ...base, lineCount: 0, evidenceLineCount: 3 })).toBe(
      true
    );
    expect(dishHasRecipe({ ...base, lineCount: 0, evidenceLineCount: 0 })).toBe(
      true
    );
    expect(
      dishHasRecipe({
        menuItemId: "m1",
        versionId: null,
        lineCount: 0,
        evidenceLineCount: 0,
      })
    ).toBe(false);
    expect(
      dishHasRecipe({
        menuItemId: null,
        versionId: "v1",
        lineCount: 2,
        evidenceLineCount: 0,
      })
    ).toBe(false);
  });

  // A dish whose recipe id lives ONLY on its POS link, with a legacy line copy
  // ($4.15 from the Excel) and an ingredient (BEBIDA) that has no price.
  const dish = econ({
    links: [link(7, { menu_item_id: "m1" })],
    versions: [ver({ id: "v1", menu_item_id: "m1", status: "in_review" })],
    inputs: new Map([["v1", [legacyLine]]]),
    sales: [[7, "Refresco"]],
  }).dishes.find((d) => d.odoo_product_id === 7)!;

  it("finds the version through the link", () => {
    expect(dish.recipe_version_id).toBe("v1");
    expect(dish.menu_item_id).toBe("m1");
  });

  it("a legacy unit_cost is not a price: Sin precio, no cost, no margin, no %", () => {
    expect(dish.lines).toHaveLength(1);
    expect(dish.lines[0].amount).toBeNull();
    expect(dish.lines[0].pending).toBe(true);
    expect(dish.unit_cost).toBeNull();
    expect(dish.status).toBe("falta_precio");
    expect(dish.food_cost_pct).toBeNull();
    expect(dish.unit_margin).toBeNull();
  });

  it("a Reventa variant never borrows another variant's cost", () => {
    const grouped = econ({
      links: [
        link(1, { menu_item_id: "m1", classification: "plato_preparado" }),
        link(2, { menu_item_id: "m2" }),
      ],
      versions: [
        ver({ id: "v1", menu_item_id: "m1", status: "approved" }),
        ver({ id: "v2", menu_item_id: "m2" }),
      ],
      inputs: new Map([
        [
          "v1",
          [
            {
              ...legacyLine,
              id: "x",
              unit_cost: null,
              cost_source: null,
              ingredient_id: "i-beb",
            },
          ],
        ],
        ["v2", [legacyLine]],
      ]),
      sales: [
        [1, "Refresco 8oz"],
        [2, "Refresco 12oz"],
      ],
    });
    const resale = grouped.dishes.find((d) => d.odoo_product_id === 2)!;
    const sibling = grouped.dishes.find((d) => d.odoo_product_id === 1)!;
    // Same menu dish, and the sibling is the one that could lend its cost.
    expect(resale.menu_dish_id).toBe(sibling.menu_dish_id);
    expect(resale.unit_cost).toBeNull();
    expect(resale.unit_margin).toBeNull();
    expect(resale.food_cost_pct).toBeNull();
  });
});

describe("source rules", () => {
  const plato = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
  it("the Excel comparison is gray, not red", () => {
    const i = plato.indexOf("fmt(w.excelTotal");
    const before = plato.slice(Math.max(0, i - 260), i);
    expect(before).toContain("#6b7280");
    expect(before).not.toContain("#c03535");
  });
  it("the screen uses the shared helper", () => {
    expect(plato).toContain("dishHasRecipe");
    expect(plato).toContain("resolveDishMenuItemId");
    expect(read("lib/restaurant/costing/dish-economics.ts")).toContain(
      "pickDishVersion"
    );
  });
});

// ---- Reventa inline price --------------------------------------------------
const product = {
  odoo_product_id: 7,
  odoo_name: "Refresco",
  treatment: "reventa",
  treatment_label: "Reventa",
  menu_item_id: null,
  suggested_treatment: null,
  suggested_treatment_reason: null,
} as never;

function mockFetch(costsStatus: number, costsBody: unknown = {}) {
  const fn = vi.fn(async (url: string, _init?: unknown) => {
    if (String(url).startsWith("/api/restaurant/ingredients")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ingredients: [
            {
              id: "i-beb",
              name: "BEBIDA",
              default_unit: "unit",
              latest_unit_cost: null,
            },
          ],
        }),
      };
    }
    return {
      ok: costsStatus < 400,
      status: costsStatus,
      json: async () => costsBody,
    };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

async function draw(canEditPrices: boolean, onPriceSaved = vi.fn()) {
  clearIngredientOptionsCache();
  render(
    <TreatmentControl
      product={product}
      options={[]}
      canEdit
      canEditPrices={canEditPrices}
      onPriceSaved={onPriceSaved}
      busy={false}
      onPost={vi.fn()}
    />
  );
  const select = (await screen.findByText("Elige de tu lista…")).closest(
    "select"
  )!;
  fireEvent.change(select, { target: { value: "i-beb" } });
  return onPriceSaved;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TreatmentPanel inline price", () => {
  it("unit dropdowns list the Spanish units and never «unit»", async () => {
    mockFetch(200);
    await draw(true);
    const selects = screen
      .getAllByRole("combobox")
      .filter((s) => /Unidad/.test(s.getAttribute("aria-label") ?? ""));
    expect(selects).toHaveLength(2);
    for (const s of selects) {
      const values = Array.from((s as HTMLSelectElement).options).map(
        (o) => o.value
      );
      expect(values).toEqual(KITCHEN_UNITS.map((u) => u.value));
      expect(values).not.toContain("unit");
      expect((s as HTMLSelectElement).value).toBe("unidad");
    }
  });

  it("saves the BEBIDA price once through ingredient-costs, then refreshes the dish", async () => {
    const fetchFn = mockFetch(200);
    const saved = await draw(true);
    fireEvent.change(screen.getByLabelText("Precio"), {
      target: { value: "1.5" },
    });
    fireEvent.change(screen.getByLabelText("Unidad del precio"), {
      target: { value: "unidad" },
    });
    const button = screen.getByRole("button", { name: "Guardar precio" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    const posts = fetchFn.mock.calls.filter(
      ([u]) => u === "/api/restaurant/ingredient-costs"
    );
    expect(posts).toHaveLength(1);
    const body = JSON.parse((posts[0][1] as unknown as { body: string }).body);
    expect(body).toMatchObject({
      ingredient_id: "i-beb",
      quantity: 1,
      unit: "unidad",
      total_cost: 1.5,
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Guardar precio" })
      ).toBeNull()
    );
  });

  it("denies with the server's Spanish message", async () => {
    mockFetch(403, { error: "Tu rol no puede cambiar precios." });
    const saved = await draw(true);
    fireEvent.change(screen.getByLabelText("Precio"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar precio" }));
    expect(
      await screen.findByText("Tu rol no puede cambiar precios.")
    ).toBeTruthy();
    expect(saved).not.toHaveBeenCalled();
  });

  it("shows no price form to a role without prices.edit", async () => {
    mockFetch(200);
    await draw(false);
    expect(screen.queryByLabelText("Precio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar precio" })).toBeNull();
  });
});
