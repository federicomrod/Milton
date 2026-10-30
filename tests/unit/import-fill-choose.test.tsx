// @vitest-environment jsdom
// Recipe import: conflict review before «Importar», and the dish page's
// «Traer receta del último archivo». Synthetic data only.
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { buildSyntheticCostWorkbookBuffer } from "../fixtures/recipe-import-synthetic";
import { translateCostWorkbookBuffer } from "@/lib/restaurant/recipe-import/translate";
import { planImport } from "@/lib/restaurant/recipe-import/plan";
import {
  dishForProduct,
  planForOneDish,
  sameRecipeLines,
} from "@/lib/restaurant/recipe-import/last-file";
import { writeImportPlan } from "@/lib/restaurant/recipe-import/server";
import { RecipeImportPreview } from "@/components/restaurant/recipes-costing/RecipeImportPreview";
import { LastFileDialog } from "@/components/restaurant/recipes-costing/LastFileRecipe";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const workbook = translateCostWorkbookBuffer(
  buildSyntheticCostWorkbookBuffer()
);
const products = [
  {
    odoo_product_id: 1,
    odoo_name: "Asado de Prueba (6 onz.)",
    pos_price: 14.5,
    link_state: "sin_vincular",
  },
];

describe("a dish's recipe from the last file", () => {
  const plan = planImport({
    workbook,
    catalog: { ingredients: [], preparations: [] },
    products,
    existing: [],
  });

  it("finds the file's dish for a POS product, and only that one", () => {
    expect(dishForProduct(plan, 1)?.recipe.name).toBe("ASADO DE PRUEBA 6");
    expect(dishForProduct(plan, 999)).toBeNull();
  });

  it("compares by item, quantity and unit, whatever the order or spelling", () => {
    const a = [
      { name: "Sal Fina", quantity: 2, unit: "g" },
      { name: "Aceite", quantity: 1, unit: "oz" },
    ];
    expect(
      sameRecipeLines(a, [
        { name: "aceite", quantity: 1, unit: "OZ" },
        { name: "SAL FINA", quantity: 2, unit: "g" },
      ])
    ).toBe(true);
    expect(
      sameRecipeLines(a, [{ name: "Sal Fina", quantity: 3, unit: "g" }])
    ).toBe(false);
    expect(sameRecipeLines([], [])).toBe(true);
  });

  it("imports ONE dish from the file as a new draft, leaving the other versions and dishes alone", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const menu = await repo.createMenuItem({
      companyId: "co-1",
      name: "Asado de Prueba (6 onz.)",
      currency: "USD",
      sourceId: "x",
    });
    const recipe = await repo.createRecipe({
      companyId: "co-1",
      menuItemId: menu.id,
      name: "Asado",
      sourceId: "x",
      inputs: [],
    });
    store.recipes.find((r) => r.id === recipe.id)!.source_type = "manual";
    const dish = dishForProduct(plan, 1)!;
    const one = planForOneDish(plan, workbook, dish);
    expect(one.plan.dishes).toHaveLength(1);
    expect(one.workbook.recipes.length).toBeLessThan(workbook.recipes.length);
    const out = await writeImportPlan({
      repo,
      plan: one.plan,
      workbook: one.workbook,
      companyId: "co-1",
      currency: "USD",
      filename: "ultimo.xlsx",
      createdBy: "u1",
      locationId: null,
      choices: { [dish.recipe.key]: "excel" },
      insertCanonicalRows: async () => {},
    });
    const versions = store.recipeVersions.filter(
      (v) => v.recipe_id === recipe.id
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].status).toBe("in_review");
    expect(versions[0].inputs.length).toBeGreaterThan(0);
    expect(out.result.dishes_imported).toBe(1);
    // only this dish's recipe: no other dish got a version
    expect(store.recipeVersions).toHaveLength(1);
  });
});

describe("the dish page dialog", () => {
  const lookup = {
    available: true as const,
    filename: "ultimo.xlsx",
    recipe_key: "Hoja!A1",
    recipe_name: "ASADO DE PRUEBA 6",
    file: {
      lines: [
        { name: "Carne", quantity: 6, unit: "oz", unit_cost: 1, cost: 6 },
        { name: "Sal", quantity: 2, unit: "g", unit_cost: null, cost: null },
      ],
      total: null,
    },
    current: { lines: [], total: null },
    empty: true,
    differs: false,
  };
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows both recipes side by side and «Usar esta receta» creates the version from the saved file", async () => {
    const onDone = vi.fn();
    render(
      <LastFileDialog
        open
        lookup={lookup}
        odooProductId={7}
        locationId="loc-1"
        currency="USD"
        onClose={() => {}}
        onDone={onDone}
      />
    );
    expect(screen.getByText(/Tu receta ahora · 0 líneas/)).toBeTruthy();
    expect(screen.getByText(/Del archivo · 2 líneas/)).toBeTruthy();
    expect(screen.getAllByText("Sin precio").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Usar esta receta" }));
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/restaurant/recipes/last-file");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      odoo_product_id: 7,
      location_id: "loc-1",
      recipe_key: "Hoja!A1",
    });
  });
});

describe("conflict review before «Importar»", () => {
  const preview = {
    ok: true,
    tabs: [],
    rows: [],
    dishes: 3,
    matching: 3,
    preparations: 0,
    ingredients_new: 0,
    ingredients_reused: 0,
    linked: 3,
    skipped: 0,
    conflicts: [
      {
        key: "H!A1",
        dish: "Asado de Prueba",
        size: null,
        my_cost: 4.2,
        my_lines: 3,
        excel_cost: 5.1,
        excel_lines: 4,
      },
      {
        key: "H!A20",
        dish: "Parrillada de Prueba",
        size: null,
        my_cost: null,
        my_lines: 5,
        excel_cost: null,
        excel_lines: 6,
      },
    ],
  };
  let applyBody: FormData | null = null;
  beforeEach(() => {
    applyBody = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const form = init?.body as FormData;
        if (form?.get("mode") === "apply") {
          applyBody = form;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              batch_id: "b1",
              dishes_imported: 2,
              dishes_linked: 2,
              dishes_skipped: 0,
              dishes_filled: 0,
              dishes_kept: 1,
              dishes_replaced: 1,
              preparations_created: 0,
              ingredients_created: 0,
            }),
          };
        }
        return { ok: true, status: 200, json: async () => preview };
      })
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const draw = () =>
    render(
      <RecipeImportPreview
        draftToken="t1"
        initialImported={null}
        locationId={null}
        busyExternal={false}
        onImported={() => {}}
      />
    );

  it("lists each dish with both sides, defaults to «Mantener la mía», and never shows $0", async () => {
    draw();
    const section = await screen.findByTestId("import-conflicts");
    expect(section.textContent).toContain("2 platos ya tienen receta");
    expect(section.textContent).toContain("Tu receta: $4.20 · 3 líneas");
    expect(section.textContent).toContain("Excel: $5.10 · 4 líneas");
    expect(section.textContent).toContain("Tu receta: Sin precio · 5 líneas");
    const mine = screen.getAllByRole("button", { name: "Mantener la mía" });
    expect(mine.every((b) => b.getAttribute("aria-pressed") === "true")).toBe(
      true
    );
  });

  it("sends only the dishes switched to the Excel's recipe", async () => {
    draw();
    await screen.findByTestId("import-conflicts");
    fireEvent.click(
      screen.getAllByRole("button", { name: "Usar la del Excel" })[0]
    );
    fireEvent.click(screen.getByRole("button", { name: /Importar/ }));
    await vi.waitFor(() => expect(applyBody).not.toBeNull());
    expect(JSON.parse(applyBody!.get("choices") as string)).toEqual({
      "H!A1": "excel",
    });
    const note = await screen.findByText(/Mantuvimos 1 receta tuya/);
    expect(note.textContent).toContain(
      "1 plato tiene un borrador nuevo del Excel"
    );
  });

  it("«Usar Excel en todos» switches every dish", async () => {
    draw();
    await screen.findByTestId("import-conflicts");
    fireEvent.click(
      screen.getByRole("button", { name: "Usar Excel en todos" })
    );
    fireEvent.click(screen.getByRole("button", { name: /Importar/ }));
    await vi.waitFor(() => expect(applyBody).not.toBeNull());
    expect(JSON.parse(applyBody!.get("choices") as string)).toEqual({
      "H!A1": "excel",
      "H!A20": "excel",
    });
  });
});

describe("the dish page offers the last file's recipe", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const plato = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
  it("a button when the recipe is empty, the ⋯ menu entry only when it differs", () => {
    expect(read("lib/i18n/es/menu-workspace.ts")).toContain(
      "Traer receta del último archivo"
    );
    expect(plato).toMatch(/fileRecipe && fileRecipe\.empty/);
    expect(plato).toMatch(/fileRecipe\?\.differs/);
  });
  it("reuses the saved upload (no file in the request) and is one undoable batch", () => {
    const route = read("app/api/restaurant/recipes/last-file/route.ts");
    expect(route).not.toContain("formData");
    const lib = read("lib/restaurant/recipe-import/last-file.ts");
    expect(lib).toContain("loadUploadDraftFile");
    expect(lib).toContain("writeImportPlan");
  });
  it("no orange in the new pieces", () => {
    for (const f of [
      "components/restaurant/recipes-costing/LastFileRecipe.tsx",
      "components/restaurant/recipes-costing/RecipeImportPreview.tsx",
    ])
      expect(read(f), f).not.toMatch(/f28c28|e07b1|orange-/i);
  });
});
