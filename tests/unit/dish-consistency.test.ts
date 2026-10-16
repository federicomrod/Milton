// One dish status / cost everywhere, and unit fixes on APPROVED recipes.
// Synthetic names and prices only.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  calculateMenuItemCost,
  type CostingData,
} from "@/lib/restaurant/costing";
import {
  buildDishEconomics,
  totalsOf,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import { periodCostKpisFromDishEconomics } from "@/lib/restaurant/costing/dish-economics-adapter";
import { buildMenuDishes } from "@/lib/restaurant/menu-dishes/menu-dishes";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  GROUP_COVERAGE_TIP,
  groupStatusDisplay,
} from "@/lib/restaurant/costing/rollup";
import {
  UNCONFIRMED_LINK_LABEL,
  pickDishVersions,
  resolveDishState,
} from "@/lib/restaurant/costing/dish-state";
import { markApproved } from "@/lib/restaurant/recipe-costing/optimistic";
import {
  applyEdit,
  evidenceLinesOf,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  FLAG_PENDING_UNIT,
  latestPrice,
} from "@/lib/restaurant/recipe-costing/editor";
import { legacyUnitBase } from "@/lib/restaurant/legacy-line-price";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CO = "co-1";

// ---------------------------------------------------------------------------
// A small world: products with versions, a link state and priced lines
// ---------------------------------------------------------------------------
interface Product {
  id: number;
  name: string;
  net: number;
  units?: number;
  link_state?: string;
  /** The restaurant the link belongs to (a variant of another restaurant never borrows the base's recipe). */
  location?: string | null;
  versions: Array<{
    id: string;
    n: number;
    status: "approved" | "in_review";
    effective_date?: string | null;
    lines: Array<{ ing: string; qty: number; unit: string }>;
  }>;
}
const ING = [
  { id: "i-res", name: "Res de prueba", default_unit: "oz" },
  { id: "i-pollo", name: "Pollo de prueba", default_unit: "oz" },
  { id: "i-sin", name: "Sin precio de prueba", default_unit: "oz" },
];
const ENTRIES = [entry("i-res", "oz", 0.5), entry("i-pollo", "oz", 0.2)];

function costingData(): CostingData {
  return {
    ingredientsById: new Map(ING.map((i) => [i.id, i])),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(
      ENTRIES.map((e) => [e.ingredient_id, [e]])
    ),
  } as never;
}
function world(products: Product[]) {
  const data = costingData();
  const sales = products.map((p) => ({
    company_id: CO,
    raw_item_name: p.name,
    quantity: p.units ?? 10,
    gross_revenue: p.net,
    net_revenue: p.net,
    source_metadata: { product_id: p.id },
  }));
  const links = products.map((p) => ({
    company_id: CO,
    location_id: p.location ?? null,
    odoo_product_id: p.id,
    odoo_name: p.name,
    classification: "plato_preparado",
    menu_item_id: `m${p.id}`,
    link_state: p.link_state ?? "confirmado",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
  })) as never;
  const versions: DishVersion[] = products.flatMap((p) =>
    p.versions.map((v) => ({
      id: v.id,
      menu_item_id: `m${p.id}`,
      version_number: v.n,
      status: v.status,
      effective_date: v.effective_date ?? null,
      approved_at: v.status === "approved" ? "2026-10-01T10:00:00Z" : null,
      created_at: "2026-10-01T10:00:00Z",
    }))
  );
  const list = buildPosProductList({
    companyId: CO,
    sales: sales as never,
    links,
    recipeVersions: versions.map((v) => ({
      menu_item_id: v.menu_item_id,
      status: v.status,
    })) as never,
  });
  const inputs = new Map(
    products.flatMap((p) =>
      p.versions.map((v) => [
        v.id,
        v.lines.map((l, i) => ({
          id: `${v.id}-${i}`,
          input_type: "ingredient" as const,
          ingredient_id: l.ing,
          component_id: null,
          quantity: l.qty,
          unit: l.unit,
          unit_cost: null,
          cost_source: null,
        })),
      ])
    )
  );
  const economics = buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId: inputs as never,
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
  return { data, economics, versions, inputs };
}
const L = (qty: number, ing = "i-res", unit = "oz") => ({ ing, qty, unit });

// ---------------------------------------------------------------------------
describe("a group of variants says what its members are", () => {
  // Churrasco-like: 3 variants, 1 approved and confirmed (small sales), 2 drafts
  const churrasco: Product[] = [
    {
      id: 1,
      name: "Churrasco de prueba (4 oz) (Tortilla, Bien Cocido)",
      net: 50,
      versions: [{ id: "va", n: 1, status: "approved", lines: [L(4)] }],
    },
    {
      id: 2,
      name: "Churrasco de prueba (8 oz) (Tortilla, Bien Cocido)",
      net: 450,
      versions: [{ id: "vb", n: 1, status: "in_review", lines: [L(8)] }],
    },
    {
      id: 3,
      name: "Churrasco de prueba (12 oz) (Tortilla, Bien Cocido)",
      net: 500,
      versions: [{ id: "vc", n: 1, status: "in_review", lines: [L(12)] }],
    },
  ];
  const { economics } = world(churrasco);
  // The restaurant of each link: a variant of ANOTHER restaurant never borrows
  // the base's recipe (Todos los restaurantes), so every variant keeps its own state.
  const rows = economics.dishes.map((d) => {
    const own = d.odoo_product_id === 1;
    return {
      ...d,
      link_location_id: own ? "loc-a" : "loc-b",
      cost_basis: "own" as const,
      unit_cost: d.own_unit_cost ?? d.unit_cost,
      status: own ? ("aprobado" as const) : ("estimado" as const),
      covered: own,
      in_cogs: own,
    };
  });
  const menu = buildMenuDishes({
    products: rows,
    excludedNetSalesBefore: 0,
    allRestaurants: true,
  });

  it("detail = Aprobado for the approved variant; a draft with every price known is Estimado", () => {
    const by = new Map(economics.dishes.map((d) => [d.odoo_product_id, d]));
    expect(by.get(1)).toMatchObject({ status: "aprobado", covered: true });
    // the shared rule, for the two drafts
    for (const lines of [
      [{ pending: false, amount: 4 }],
      [{ pending: false, amount: 6 }],
    ]) {
      const s = resolveDishState({
        versions: [
          {
            id: "d",
            version_number: 1,
            status: "in_review",
            effective_date: null,
          },
        ],
        link: { link_state: "confirmado" },
        treatment: "plato_preparado",
        lines,
        units_sold: 10,
        net_sales: 450,
      });
      expect(s).toMatchObject({
        status: "estimado",
        covered: false,
        approved_version_id: null,
      });
    }
  });
  it("the group says «Aprobado 1 de 3» (warning) and its coverage is that variant's share of sales", () => {
    expect(menu.dishes).toHaveLength(1);
    const dish = menu.dishes[0];
    expect(dish.variant_count).toBe(3);
    expect(dish.approved_count).toBe(1);
    const chip = groupStatusDisplay(dish);
    expect(chip).toMatchObject({ label: "Aprobado 1 de 3", mixed: true });
    expect(dish.coverage).toBeCloseTo(50 / 1000, 10);
    expect(GROUP_COVERAGE_TIP).toBe(
      "Cobertura = ventas de variantes aprobadas / ventas del grupo"
    );
  });
  it("the ranking, the Platos list and the Cockpit read the same coverage", () => {
    // Cockpit (dish economics) with the same rows
    const sameRows = {
      ...economics,
      dishes: rows,
      totals: totalsOf(rows, { food_net_sales: 1000, excluded_net_sales: 0 }),
    };
    expect(periodCostKpisFromDishEconomics(sameRows).coverage_pct).toBe(
      menu.totals.coverage_pct
    );
    expect(menu.totals.coverage_pct).toBe(5);
    expect(menu.dishes[0].coverage * 100).toBeCloseTo(5, 10);
  });
  it("all approved → «Aprobado»; none approved → the worst status as today", () => {
    expect(
      groupStatusDisplay({
        cost_status: "aprobado",
        approved_count: 3,
        variant_count: 3,
      }).label
    ).toBe("Aprobado");
    expect(
      groupStatusDisplay({
        cost_status: "falta_precio",
        approved_count: 0,
        variant_count: 3,
      }).label
    ).toBe("Falta precio");
    expect(
      groupStatusDisplay({
        cost_status: "estimado",
        approved_count: 0,
        variant_count: 1,
      }).label
    ).toBe("Estimado");
  });
});

describe("an approved recipe whose link is not confirmed", () => {
  const { economics } = world([
    {
      id: 7,
      name: "Plato de prueba",
      net: 100,
      link_state: "sugerido",
      versions: [{ id: "v1", n: 1, status: "approved", lines: [L(4)] }],
    },
  ]);
  const d = economics.dishes[0];
  it("is «aprobado» with covered=false and the reason, on the dish", () => {
    expect(d.status).toBe("aprobado");
    expect(d.covered).toBe(false);
    expect(d.in_cogs).toBe(false);
    expect(d.state_reason).toBe("vinculo_sin_confirmar");
    expect(d.status_label).toBe(UNCONFIRMED_LINK_LABEL);
    expect(d.unit_cost).toBeCloseTo(2, 10); // its cost IS known
  });
  it("the same on the Platos list, the totals and the Cockpit", () => {
    const menu = buildMenuDishes({
      products: economics.dishes,
      excludedNetSalesBefore: 0,
    });
    expect(menu.dishes[0].variants[0].covered).toBe(false);
    expect(menu.dishes[0].variants[0].status).toBe("aprobado");
    expect(menu.totals.coverage_pct).toBe(0);
    expect(periodCostKpisFromDishEconomics(economics).coverage_pct).toBe(0);
  });
  it("resolveDishState gives the same answer", () => {
    const s = resolveDishState({
      versions: [
        {
          id: "v1",
          version_number: 1,
          status: "approved",
          effective_date: null,
        },
      ],
      link: { link_state: "sugerido" },
      treatment: "plato_preparado",
      lines: [{ pending: false, amount: 2 }],
      units_sold: 10,
      net_sales: 100,
    });
    expect(s).toMatchObject({
      status: "aprobado",
      covered: false,
      reason: "vinculo_sin_confirmar",
      approved_version_id: "v1",
    });
  });
});

describe("the approved version in force is the engine's pick (effective dates)", () => {
  it("a LATER-numbered approved version that is not in force yet is not used: same version and cost in the engine and in dish economics", () => {
    const { economics, data } = world([
      {
        id: 9,
        name: "Plato de prueba",
        net: 100,
        versions: [
          { id: "v1", n: 1, status: "approved", lines: [L(4)] },
          {
            id: "v2",
            n: 2,
            status: "approved",
            effective_date: "2999-01-01",
            lines: [L(8)],
          },
        ],
      },
    ]);
    const d = economics.dishes[0];
    expect(d.recipe_version_id).toBe("v1");
    expect(d.unit_cost).toBeCloseTo(2, 10);
    // the engine, with the same versions
    data.menuItemsById = new Map([
      [
        "m9",
        { id: "m9", name: "x", selling_price: null, currency: null } as never,
      ],
    ]);
    data.menuRecipesByMenuItemId = new Map([
      ["m9", { id: "r9", menu_item_id: "m9", status: "active" } as never],
    ]);
    data.menuRecipeInputsByRecipeId = new Map();
    data.menuRecipeVersionsByMenuItemId = new Map([
      [
        "m9",
        [
          {
            id: "v1",
            recipe_id: "r9",
            menu_item_id: "m9",
            version_number: 1,
            status: "approved",
            effective_date: null,
          },
          {
            id: "v2",
            recipe_id: "r9",
            menu_item_id: "m9",
            version_number: 2,
            status: "approved",
            effective_date: "2999-01-01",
          },
        ],
      ],
    ]);
    data.menuRecipeVersionInputsByVersionId = new Map([
      [
        "v1",
        [
          {
            input_type: "ingredient",
            ingredient_id: "i-res",
            component_id: null,
            quantity: 4,
            unit: "oz",
          },
        ],
      ],
      [
        "v2",
        [
          {
            input_type: "ingredient",
            ingredient_id: "i-res",
            component_id: null,
            quantity: 8,
            unit: "oz",
          },
        ],
      ],
    ]);
    expect(calculateMenuItemCost("m9", data).cost).toBeCloseTo(
      d.unit_cost!,
      10
    );
  });
  it("once the later version's date arrives both pick it", () => {
    const versions = [
      { id: "v1", version_number: 1, status: "approved", effective_date: null },
      {
        id: "v2",
        version_number: 2,
        status: "approved",
        effective_date: "2026-09-01",
      },
    ];
    expect(pickDishVersions(versions, "2026-10-15").approved?.id).toBe("v2");
    expect(pickDishVersions(versions, "2026-08-01").approved?.id).toBe("v1");
    const { economics } = world([
      {
        id: 9,
        name: "Plato de prueba",
        net: 100,
        versions: [
          { id: "v1", n: 1, status: "approved", lines: [L(4)] },
          {
            id: "v2",
            n: 2,
            status: "approved",
            effective_date: "2026-09-01",
            lines: [L(8)],
          },
        ],
      },
    ]);
    expect(economics.dishes[0].recipe_version_id).toBe("v2");
    expect(economics.dishes[0].unit_cost).toBeCloseTo(4, 10);
  });
  it("approvedInForce is gone", () => {
    expect(read("lib/restaurant/costing/dish-economics.ts")).not.toContain(
      "approvedInForce"
    );
  });
});

describe("«Aprobar» (markApproved) is the server's rule, not a hand-set status", () => {
  const draft = (lines: Product["versions"][number]["lines"]) =>
    world([
      {
        id: 4,
        name: "Plato de prueba",
        net: 100,
        link_state: "sugerido",
        versions: [{ id: "v1", n: 1, status: "in_review", lines }],
      },
    ]);
  const approvedServer = (lines: Product["versions"][number]["lines"]) =>
    world([
      {
        id: 4,
        name: "Plato de prueba",
        net: 100,
        link_state: "confirmado",
        versions: [{ id: "v1", n: 1, status: "approved", lines }],
      },
    ]);
  const strip = (
    d: (typeof draft extends (...a: never[]) => infer R
      ? R
      : never)["economics"]["dishes"][number]
  ) => {
    const { lines: _l, ...rest } = d;
    return rest;
  };
  const approveLocally = (summary: ReturnType<typeof strip>) =>
    markApproved(
      {
        dish_summaries: [summary],
        selected_dish: null,
        plato_queue: [],
      } as never,
      4
    ).dish_summaries![0];

  it("every line priced: the optimistic result equals the server's after approving", () => {
    const local = approveLocally(strip(draft([L(4)]).economics.dishes[0]));
    const server = approvedServer([L(4)]).economics.dishes[0];
    for (const k of [
      "status",
      "covered",
      "in_cogs",
      "unit_cost",
      "food_cost_pct",
      "state_reason",
    ] as const) {
      expect(local[k], k).toEqual(server[k] ?? null);
    }
  });
  it("a line without a price: both say «Falta precio» (never a hand-set Aprobado)", () => {
    const local = approveLocally(
      strip(draft([L(4), L(2, "i-sin")]).economics.dishes[0])
    );
    const server = approvedServer([L(4), L(2, "i-sin")]).economics.dishes[0];
    expect(local.status).toBe("falta_precio");
    expect(server.status).toBe("falta_precio");
    expect(local.covered).toBe(false);
    expect(local.unit_cost).toBeNull();
  });
  it("optimistic.ts no longer sets 'aprobado' by hand", () => {
    const src = read("lib/restaurant/recipe-costing/optimistic.ts");
    expect(src).not.toMatch(/status:\s*"aprobado"/);
    expect(src).toContain("dishStateFrom(");
  });
});

// ---------------------------------------------------------------------------
// Approved recipes: unit fixes that do not touch the recipe
// ---------------------------------------------------------------------------
function approvedRecipe(over: Parameters<typeof memoryEditorState>[0]) {
  return memoryEditorState({
    version: { id: "v1", status: "approved", kind: "dish", menu_item_id: "m1" },
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
    ...over,
  });
}
const ctxOf = (state: ReturnType<typeof approvedRecipe>) => ({
  store: createMemoryEditorStore(state),
  companyId: CO,
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});
const line = (id: string, ing: string, qty: number, unit: string) => ({
  id,
  input_type: "ingredient" as const,
  ingredient_id: ing,
  component_id: null,
  quantity: qty,
  unit,
  unit_cost: null,
  cost_source: null,
});

describe("Parrillada-like approved recipe: POLLO 12 onza priced $0.235 per unidad", () => {
  const build = () =>
    approvedRecipe({
      ingredients: [
        { id: "i-pollo", name: "Pollo de prueba", default_unit: "unit" },
      ],
      entries: [entry("i-pollo", "unit", 0.235)],
      inputs: [line("l1", "i-pollo", 12, "onza")],
    });
  it("is «Unidad distinta» + Sin precio", async () => {
    const r = await loadEditor(ctxOf(build()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.editable).toBe(false);
    expect(r.state.lines[0].amount).toBeNull();
    expect(r.state.lines[0].flags).toContain(FLAG_PENDING_UNIT);
    expect(r.state.total_cost).toBeNull();
  });
  it("«Corregir unidad del precio» to onza: a NEW dated entry, the dish is costed (12 × 0.235 = $2.82), the recipe and the old entry are untouched", async () => {
    const state = build();
    const versionBefore = JSON.stringify(state.version);
    const inputsBefore = JSON.stringify(state.inputs);
    const oldEntry = JSON.stringify(state.entries[0]);
    const ctx = ctxOf(state);
    const r = await applyEdit(ctx, {
      action: "set_price",
      ingredient_id: "i-pollo",
      unit: "oz",
      unit_cost: 0.235,
      correct_unit: true,
    });
    expect(r.ok).toBe(true);
    expect(state.entries).toHaveLength(2);
    expect(JSON.stringify(state.entries[0])).toBe(oldEntry); // never edited or deleted
    expect(state.entries[1]).toMatchObject({
      normalized_unit: "oz",
      notes: "Unidad corregida",
      source_type: "manual",
    });
    expect(JSON.stringify(state.version)).toBe(versionBefore);
    expect(JSON.stringify(state.inputs)).toBe(inputsBefore);
    const after = await loadEditor(ctx);
    expect(after.ok && after.state.lines[0].amount).toBeCloseTo(12 * 0.235, 10);
    expect(after.ok && after.state.total_cost).toBeCloseTo(2.82, 2);
    expect(after.ok && after.state.editable).toBe(false);
  });
});

describe("Chorizo-like approved recipe: 3 unidad with $0.31 per onza", () => {
  it("«Definir conversión» (1 unidad = N oz) costs it and the recipe is unchanged", async () => {
    const state = approvedRecipe({
      ingredients: [
        { id: "i-chorizo", name: "Chorizo de prueba", default_unit: "oz" },
      ],
      entries: [entry("i-chorizo", "oz", 0.31)],
      inputs: [line("l1", "i-chorizo", 3, "unidad")],
    });
    const ctx = ctxOf(state);
    const before = await loadEditor(ctx);
    expect(before.ok && before.state.lines[0].amount).toBeNull();
    expect(before.ok && before.state.lines[0].flags).toContain(
      FLAG_PENDING_UNIT
    );
    const inputsBefore = JSON.stringify(state.inputs);
    // the conversion is ingredient data, not recipe data
    state.conversions = [
      {
        ingredient_id: "i-chorizo",
        from_unit: "unidad",
        to_unit: "oz",
        factor: 2,
      },
    ];
    const after = await loadEditor(ctx);
    expect(after.ok && after.state.lines[0].amount).toBeCloseTo(
      3 * 2 * 0.31,
      10
    );
    expect(JSON.stringify(state.inputs)).toBe(inputsBefore);
    expect(state.version?.status).toBe("approved");
  });
  it("the screen offers «Definir conversión» and «Corregir unidad del precio» on an approved recipe", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(src).toMatch(
      /priceUnitMismatch && canFixPrice && line\.ingredient_id/
    );
    expect(src).toContain("Corregir unidad del precio");
    expect(src).toContain("canFixPrice={!busy && !forceLocked}");
    expect(src).not.toMatch(/priceUnitMismatch && editable/);
    expect(
      read("components/restaurant/menu/IngredientConversions.tsx")
    ).toContain("Corregir unidad del precio");
  });
});

describe("«Crear versión nueva» on an approved recipe", () => {
  it("creates a draft copy; the approved version and its lines are not changed", async () => {
    const state = approvedRecipe({
      ingredients: [{ id: "i-res", name: "Res de prueba", default_unit: "oz" }],
      entries: [entry("i-res", "oz", 0.5)],
      inputs: [line("l1", "i-res", 6, "oz")],
    });
    const approvedInputs = JSON.stringify(state.inputs);
    const ctx = ctxOf(state);
    const r = await applyEdit(ctx, { action: "new_version" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.editable).toBe(true);
    expect(r.state.lines).toHaveLength(1);
    expect(r.state.lines[0]).toMatchObject({
      qty: 6,
      unit: "oz",
      ingredient_id: "i-res",
    });
    // the approved one is kept, untouched
    expect(state.olderVersions).toHaveLength(1);
    expect(state.olderVersions![0].version.status).toBe("approved");
    expect(JSON.stringify(state.olderVersions![0].inputs)).toBe(approvedInputs);
    // a second click: there is already an open draft
    const again = await applyEdit(ctx, { action: "new_version" });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(409);
  });
  it("the button and its hint are on approved recipes", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(src).toContain("Crear versión nueva");
    expect(src).toContain(
      "La receta aprobada no se cambia; se crea un borrador."
    );
  });
});

describe("diagnostics and the Spanish unit labels", () => {
  it("legacy_unit_base knows onza, libra, gramo, litro, unidad", () => {
    expect(legacyUnitBase("onza").family).toBe("weight");
    expect(legacyUnitBase("Libras").factor).toBeCloseTo(453.59237, 5);
    expect(legacyUnitBase("gramo")).toEqual({ family: "weight", factor: 1 });
    expect(legacyUnitBase("litros")).toEqual({
      family: "volume",
      factor: 1000,
    });
    expect(legacyUnitBase("unidad")).toEqual({ family: "count", factor: 1 });
    expect(legacyUnitBase("onza").family).toBe(legacyUnitBase("oz").family);
  });
  it("058 is an additive CREATE OR REPLACE of the helper (no table access, closed to anon)", () => {
    const sql = read("supabase/migrations/058_legacy_unit_base_spanish.sql");
    for (const w of [
      "onza",
      "libra",
      "gramo",
      "kilo",
      "litro",
      "mililitro",
      "galón",
      "unidad",
    ])
      expect(sql).toContain(`'${w}'`);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.legacy_unit_base");
    expect(sql).not.toMatch(/INSERT|UPDATE|DELETE|DROP|ALTER TABLE/i);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.legacy_unit_base\(text\) FROM PUBLIC, anon/
    );
  });
  it("docs/diagnostics/unit-mismatch.sql is read-only and has no client names", () => {
    const sql = read("docs/diagnostics/unit-mismatch.sql");
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i
    );
    expect(code).toContain("ingredient_unit_conversions");
    expect(code).toContain("legacy_unit_base");
    expect(sql).not.toMatch(/ranchos|lavara|stage test|casa prueba/i);
  });
});
