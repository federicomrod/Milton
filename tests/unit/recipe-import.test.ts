// Recipe import: the cost file → canonical recipe table → plan. Synthetic
// workbook only (tests/fixtures/recipe-import-synthetic.ts); no client data.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildSyntheticCostWorkbookBuffer } from "../fixtures/recipe-import-synthetic";
import {
  dishSize,
  singleRef,
  sumRowRange,
  translateCostWorkbookBuffer,
} from "@/lib/restaurant/recipe-import/translate";
import {
  excelPriceWithIva,
  matchDishToPos,
  planImport,
  type PlanPosProduct,
} from "@/lib/restaurant/recipe-import/plan";
import type { CanonicalRecipe } from "@/lib/restaurant/recipe-import/types";
import { writeImportPlan } from "@/lib/restaurant/recipe-import/server";
import {
  existingRecipeState,
  isKeptRecipe,
} from "@/lib/restaurant/recipe-import/existing";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";
import {
  calculateMenuItemCost,
  lineOwnCost,
  type CostingData,
} from "@/lib/restaurant/costing";

const workbook = translateCostWorkbookBuffer(
  buildSyntheticCostWorkbookBuffer()
);
const byName = (name: string): CanonicalRecipe => {
  const hit = workbook.recipes.find((r) => r.name === name);
  if (!hit) throw new Error(`no recipe ${name}`);
  return hit;
};
const line = (recipe: CanonicalRecipe, ingredient: string) => {
  const hit = recipe.lines.find((l) => l.ingredient_name === ingredient);
  if (!hit) throw new Error(`no line ${ingredient}`);
  return hit;
};

describe("translating the cost file", () => {
  it("finds every block on every tab: dishes and preparations", () => {
    const dishes = workbook.recipes.filter((r) => r.kind === "dish");
    const preps = workbook.recipes.filter((r) => r.kind === "preparation");
    expect(dishes.map((r) => r.name).sort()).toEqual([
      "ASADO DE PRUEBA 6",
      "ASADO DE PRUEBA 6 (EVENTOS)",
      "ASADO DE PRUEBA 8",
      "PARRILLADA DE PRUEBA PARA 3",
    ]);
    expect(preps.map((r) => r.name).sort()).toEqual([
      "ACOMPAÑAMIENTO DE PRUEBA",
      "CARNE DE PRUEBA 2 LIBRA",
      "OPCIONES BASICAS",
      "OPCIONES PREMIUM",
    ]);
  });

  it("keeps the canonical columns for each line", () => {
    const asado = byName("ASADO DE PRUEBA 6");
    expect(asado.lines).toHaveLength(5);
    expect(line(asado, "ASADO DE RES")).toMatchObject({
      dish_name: "ASADO DE PRUEBA",
      size: "6 oz",
      unit: "ONZA",
      unit_norm: "oz",
      quantity: 6,
      unit_cost: 0.5,
      line_total: 3,
      excel_total_cost: 3.203,
      source_tab: "DE LA PARRILLA",
      source_cell: "B8",
    });
    expect(asado.excel_price_sin_iva).toBeCloseTo(14.5 / 1.13, 6);
    expect(asado.calculated_cost).toBeCloseTo(3.203, 6);
    expect(asado.flags).not.toContain("excel_no_cuadra");
  });

  it("never turns #ERROR!, empty or $0 into a $0 cost: Pendiente and flagged", () => {
    const queso = line(byName("ASADO DE PRUEBA 6"), "QUESO DE PRUEBA");
    expect(queso.unit_cost).toBeNull();
    expect(queso.flags).toContain("costo_pendiente");
    expect(byName("ASADO DE PRUEBA 6").flags).toContain("lineas_pendientes");
  });

  it("imports odd lines as written and flags them", () => {
    expect(line(byName("ASADO DE PRUEBA 6"), "PIMIENTA").flags).toContain(
      "cantidad_cero"
    );
    const libra = line(byName("PARRILLADA DE PRUEBA PARA 3"), "ASADO DE RES");
    expect(libra.unit).toBe("LIBRA");
    expect(libra.flags).toContain("unidad_distinta");
    const typo = line(byName("PARRILLADA DE PRUEBA PARA 3"), "CONVOY");
    expect(typo.unit).toBe("UNIIDAD");
    expect(typo.flags).toContain("unidad_no_reconocida");
  });

  it("flags a different cost for the same ingredient elsewhere, keeping each", () => {
    const six = line(byName("ASADO DE PRUEBA 6"), "ASADO DE RES");
    const eight = line(byName("ASADO DE PRUEBA 8"), "ASADO DE RES");
    expect(six.unit_cost).toBe(0.5);
    expect(eight.unit_cost).toBe(0.56);
    expect(six.flags).toContain("costo_distinto");
    expect(eight.flags).toContain("costo_distinto");
  });

  it("says when the Excel's own COSTO TOTAL leaves a line out", () => {
    const eight = byName("ASADO DE PRUEBA 8");
    expect(line(eight, "ACEITE").flags).toContain("fuera_del_total_excel");
    expect(eight.calculated_cost).toBeCloseTo(4.56, 6);
    expect(eight.excel_total_cost).toBe(4.48);
    expect(eight.flags).toContain("excel_no_cuadra");
  });

  it("links a line to the preparation its cost points at", () => {
    const acomp = line(byName("ASADO DE PRUEBA 6"), "ACOMPAÑAMIENTO");
    expect(acomp.preparation_key).toBe(byName("ACOMPAÑAMIENTO DE PRUEBA").key);
    expect(
      line(byName("ASADO DE PRUEBA 6"), "ASADO DE RES").preparation_key
    ).toBeNull();
  });

  it("reads a preparation's yield from its PRECIO POR row", () => {
    expect(byName("CARNE DE PRUEBA 2 LIBRA").output).toEqual({
      quantity: 32,
      unit: "oz",
    });
    const acomp = byName("ACOMPAÑAMIENTO DE PRUEBA");
    expect(acomp.output).toEqual({ quantity: 1, unit: "orden" });
    expect(acomp.flags).toContain("rendimiento_supuesto");
  });

  it("splits a side-dish block into its option lists, averaged per orden", () => {
    const basic = byName("OPCIONES BASICAS");
    expect(basic.lines.map((l) => l.ingredient_name)).toEqual(["PAPA", "YUCA"]);
    expect(basic.output).toEqual({ quantity: 2, unit: "orden" });
    expect(basic.flags).toContain("promedio_de_opciones");
    expect(
      byName("OPCIONES PREMIUM").lines.map((l) => l.ingredient_name)
    ).toEqual(["VEGETALES"]);
  });

  it("reads sizes from dish titles", () => {
    expect(dishSize("ASADO TIPICO 6")).toMatchObject({
      base: "ASADO TIPICO",
      size: "6 oz",
    });
    expect(dishSize("TACON ALTO 8 ONZAS")).toMatchObject({
      base: "TACON ALTO",
      value: 8,
      kind: "oz",
    });
    expect(dishSize("PARRILLADA DE LA CASA PARA 3")).toMatchObject({
      base: "PARRILLADA DE LA CASA",
      size: "3 personas",
    });
    expect(dishSize("PECHUGA DE POLLO")).toMatchObject({ size: null });
  });

  it("parses the formulas it relies on", () => {
    expect(singleRef("SUM('SUB RECETAS 2'!F341)", "X")).toEqual({
      sheet: "SUB RECETAS 2",
      cell: "F341",
    });
    expect(singleRef("+E18", "DE LA PARRILLA")).toEqual({
      sheet: "DE LA PARRILLA",
      cell: "E18",
    });
    expect(singleRef("4.5/453", "X")).toBeNull();
    expect(sumRowRange("SUM(F24:G29)")).toEqual({ from: 24, to: 29 });
    expect(sumRowRange("SUM(E21)")).toBeNull();
  });
});

describe("planning the import", () => {
  const products: PlanPosProduct[] = [
    {
      odoo_product_id: 1,
      odoo_name: "Asado de Prueba (6 onz.)",
      pos_price: 14.5,
      link_state: "sin_vincular",
    },
    {
      odoo_product_id: 2,
      odoo_name: "Asado de Prueba (8 oz)",
      pos_price: 25,
      link_state: "sin_vincular",
    },
    {
      odoo_product_id: 3,
      odoo_name: "Parrillada de Prueba (3 personas)",
      pos_price: 31.5,
      link_state: "sin_vincular",
    },
  ];
  const plan = planImport({
    workbook,
    catalog: {
      ingredients: [{ id: "ing-sal", name: "Sal" }],
      preparations: [],
    },
    products,
    existing: [],
  });
  const dish = (name: string) =>
    plan.dishes.find((d) => d.recipe.name === name)!;

  it("links by name + size, confirmed by price × 1.13", () => {
    expect(excelPriceWithIva(byName("ASADO DE PRUEBA 6"))).toBe(14.5);
    expect(dish("ASADO DE PRUEBA 6").pos.map((p) => p.odoo_product_id)).toEqual(
      [1]
    );
    expect(
      dish("PARRILLADA DE PRUEBA PARA 3").pos.map((p) => p.odoo_product_id)
    ).toEqual([3]);
  });

  it("does not link when the price disagrees", () => {
    expect(dish("ASADO DE PRUEBA 8").pos).toEqual([]);
    expect(dish("ASADO DE PRUEBA 8").link_note).toMatch(/precio no coincide/);
  });

  it("the events copy never takes the main dish's POS product", () => {
    expect(dish("ASADO DE PRUEBA 6 (EVENTOS)").pos).toEqual([]);
  });

  it("creates one ingredient per name and reuses the catalog's", () => {
    const names = plan.ingredients.map((i) => i.name);
    expect(names.filter((n) => n === "ASADO DE RES")).toHaveLength(1);
    expect(plan.ingredients.find((i) => i.name === "SAL")).toMatchObject({
      existing_id: "ing-sal",
      existing_name: "Sal",
    });
    // A line that uses a preparation is not an ingredient.
    expect(names).not.toContain("ACOMPAÑAMIENTO");
  });

  it("a dish with a recipe that has lines is a conflict (kept unless chosen), with both sides to compare", () => {
    const guarded = planImport({
      workbook,
      catalog: { ingredients: [], preparations: [] },
      products,
      existing: [{ odoo_product_id: 1, protected: true, lines: 3, cost: 4.2 }],
    });
    const hit = guarded.dishes.find(
      (d) => d.recipe.name === "ASADO DE PRUEBA 6"
    );
    expect(hit?.conflict).toEqual({ my_lines: 3, my_cost: 4.2 });
    expect(hit?.skip_reason).toBeNull();
    expect(hit?.pos.map((p) => p.odoo_product_id)).toEqual([1]);
    const row = guarded.preview.conflicts.find(
      (c) => c.dish === hit?.recipe.name
    );
    expect(row).toMatchObject({ my_lines: 3, odoo_product_id: 1 });
    expect(row?.excel_lines).toBeGreaterThan(0);
  });

  it("previews one row per dish: our cost, Excel total, match, flags", () => {
    const row = plan.preview.rows.find((r) => r.dish === "ASADO DE PRUEBA 8")!;
    expect(row).toMatchObject({
      calculated_cost: 4.56,
      excel_total_cost: 4.48,
      match: false,
    });
    expect(row.flags.join(" ")).toMatch(/Excel no cuadra/);
    expect(plan.preview.dishes).toBe(4);
    expect(plan.preview.matching).toBe(3);
  });

  it("matches the POS by name only when the name is clearly the same", () => {
    const hit = matchDishToPos(byName("ASADO DE PRUEBA 6"), [
      {
        odoo_product_id: 9,
        odoo_name: "Pollo Asado (6 onz.)",
        pos_price: 14.5,
        link_state: null,
      },
    ]);
    expect(hit.products).toEqual([]);
  });

  it("links every POS variant of a dish, modifiers in parentheses ignored", () => {
    const pos = (id: number, name: string, price: number | null) => ({
      odoo_product_id: id,
      odoo_name: name,
      pos_price: price,
      link_state: null,
    });
    const hit = matchDishToPos(byName("ASADO DE PRUEBA 6"), [
      pos(21, "Asado de Prueba (6 onz.) (Pan con Ajo, Bien Cocido)", 14.5),
      pos(22, "Asado de Prueba (6 onz.) (Tortilla, Término Medio)", 14.5),
      pos(23, "Asado de Prueba (8 onz.) (Pan con Ajo)", 17.25),
      // A POS that reports prices without IVA.
      pos(24, "ASADO DE PRUEBA 6 ONZ (Sin cebolla)", 12.83),
    ]);
    expect(hit.products.map((p) => p.odoo_product_id)).toEqual([21, 22, 24]);
  });

  it("says the POS price when the price is what blocks the link", () => {
    const hit = matchDishToPos(byName("ASADO DE PRUEBA 6"), [
      {
        odoo_product_id: 31,
        odoo_name: "Asado de Prueba (6 onz.) (Pan con Ajo)",
        pos_price: 9.99,
        link_state: null,
      },
    ]);
    expect(hit.products).toEqual([]);
    expect(hit.note).toMatch(/POS 9\.99/);
  });
});

describe("a recipe line with its own cost", () => {
  it("an ingredient line never costs from its own copy (the ingredient's cost entry is the one price)", () => {
    expect(
      lineOwnCost({
        input_type: "ingredient",
        ingredient_id: "a",
        component_id: null,
        quantity: 6,
        unit: "oz",
        unit_cost: 0.42,
      })
    ).toBeNull();
  });

  it("a preparation line (no price record of its own) costs quantity × its own cost", () => {
    expect(
      lineOwnCost({
        input_type: "component",
        ingredient_id: null,
        component_id: "c",
        quantity: 6,
        unit: "oz",
        unit_cost: 0.42,
      })
    ).toBeCloseTo(2.52, 6);
    expect(
      lineOwnCost({
        input_type: "ingredient",
        ingredient_id: "a",
        component_id: null,
        quantity: 6,
        unit: "oz",
        unit_cost: null,
      })
    ).toBeNull();
    expect(
      lineOwnCost({
        input_type: "ingredient",
        ingredient_id: "a",
        component_id: null,
        quantity: 6,
        unit: "oz",
        unit_cost: 0,
      })
    ).toBeNull();
  });

  it("the engine uses a preparation line's own cost, and leaves an ingredient line with no entry as Sin precio", () => {
    const data: CostingData = {
      ingredientsById: new Map([["res", { id: "res", name: "RES" } as never]]),
      componentsById: new Map(),
      componentRecipesByComponentId: new Map(),
      componentRecipeInputsByRecipeId: new Map(),
      menuItemsById: new Map([
        ["m", { id: "m", name: "Plato", selling_price: 14.5, currency: "USD" }],
      ]),
      menuRecipesByMenuItemId: new Map([
        ["m", { id: "r", menu_item_id: "m", status: "active" }],
      ]),
      menuRecipeInputsByRecipeId: new Map([
        [
          "r",
          [
            {
              input_type: "ingredient",
              ingredient_id: "res",
              component_id: null,
              quantity: 6,
              unit: "oz",
              unit_cost: 0.5,
            },
            {
              input_type: "component",
              component_id: "convoy",
              ingredient_id: null,
              quantity: 1,
              unit: "convoy",
              unit_cost: 0.9,
            },
          ],
        ],
      ]),
      costEntriesByIngredientId: new Map(),
    };
    const result = calculateMenuItemCost("m", data);
    // RES (an ingredient) has no cost entry: its 0.5 line copy is ignored.
    expect(result.status).not.toBe("complete");
    expect(result.cost).toBeNull();
    // Give RES an entry: now the dish costs 6 × 0.5 (entry) + 0.9 (preparation).
    data.costEntriesByIngredientId = new Map([
      [
        "res",
        [
          {
            id: "e1",
            ingredient_id: "res",
            cost_date: "2026-10-01",
            normalized_unit: "oz",
            normalized_unit_cost: 0.5,
            currency: "USD",
          } as never,
        ],
      ],
    ]);
    const priced = calculateMenuItemCost("m", data);
    expect(priced.status).toBe("complete");
    expect(priced.cost).toBeCloseTo(3.9, 6);
  });
});

describe("migration 043 — canonical recipe table", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase/migrations/043_recipe_canonical_lines.sql"),
    "utf8"
  );
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("is additive: one table and nullable columns, no drops or data changes", () => {
    expect(statements).toContain(
      "CREATE TABLE IF NOT EXISTS public.recipe_canonical_lines"
    );
    expect(statements).toContain(
      "ADD COLUMN IF NOT EXISTS unit_cost numeric(14,8) NULL"
    );
    expect(statements).toContain(
      "ADD COLUMN IF NOT EXISTS cost_source text NULL"
    );
    expect(statements).not.toMatch(/\bDROP\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
    expect(statements).not.toMatch(/\bUPDATE\s+public\./);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/);
  });

  it("is company-scoped with RLS like 038/039/042", () => {
    expect(statements).toContain(
      "company_id          uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE"
    );
    expect(statements).toContain("ENABLE ROW LEVEL SECURITY");
    expect(statements).toContain("is_company_member(company_id)");
    expect(statements).toContain(
      "GRANT ALL ON TABLE public.recipe_canonical_lines TO anon, authenticated, service_role"
    );
  });

  it("carries the staging-only header and no production apply", () => {
    expect(sql).toContain("manually into the Supabase SQL Editor");
    expect(sql).toContain("No production apply");
  });
});

describe("writing the import (in-memory repository)", () => {
  async function run() {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const plan = planImport({
      workbook,
      catalog: { ingredients: [], preparations: [] },
      products: [
        {
          odoo_product_id: 1,
          odoo_name: "Asado de Prueba (6 onz.)",
          pos_price: 14.5,
          link_state: "sin_vincular",
        },
      ],
      existing: [],
    });
    const canonical: Array<Record<string, unknown>> = [];
    const out = await writeImportPlan({
      repo,
      plan,
      workbook,
      companyId: "co-1",
      currency: "USD",
      filename: "costos-prueba.xlsx",
      createdBy: "u1",
      locationId: null,
      insertCanonicalRows: async (rows) => {
        canonical.push(...rows);
      },
    });
    return { store, out, canonical };
  }

  it("creates each ingredient once and every preparation as a draft", async () => {
    const { store, out } = await run();
    const names = store.ingredients.map((row) => row.name);
    expect(names.filter((n) => n === "ASADO DE RES")).toHaveLength(1);
    expect(names).not.toContain("ACOMPAÑAMIENTO");
    expect(out.result.preparations_created).toBe(4);
    expect(
      store.componentRecipeVersions.every((v) => v.status === "in_review")
    ).toBe(true);
  });

  it("saves every dish as an in_review draft with the file's cost on each line", async () => {
    const { store, out } = await run();
    expect(out.result.dishes_imported).toBe(4);
    expect(store.recipeVersions.every((v) => v.status === "in_review")).toBe(
      true
    );
    const asado = store.recipeVersions.find((v) =>
      v.inputs.some((i) => i.quantity === 6 && i.unit_cost === 0.5)
    )!;
    expect(asado.inputs).toHaveLength(4); // PIMIENTA (qty 0) is not a line
    // The dish sheet's own Costo Unitario, marked as such.
    expect(asado.inputs.find((i) => i.quantity === 6)).toMatchObject({
      input_type: "ingredient",
      unit: "oz",
      unit_cost: 0.5,
      cost_source: "excel_line",
    });
    // #ERROR! stays Pendiente: no cost on the line, never 0, and no
    // "excel_line" mark (the price list may fill it).
    const queso = asado.inputs.find(
      (i) => i.input_type === "ingredient" && i.unit_cost == null
    )!;
    expect(queso.unit_cost ?? null).toBeNull();
    expect(queso.cost_source ?? null).toBeNull();
    // The line whose cost points at a preparation uses it.
    expect(
      asado.inputs.find((i) => i.input_type === "component")
    ).toMatchObject({
      unit_cost: 0.2,
      cost_source: "excel_line",
    });
  });

  it("links only the sure POS match, as Sugerido, and records one batch", async () => {
    const { store, out, canonical } = await run();
    expect(store.posProductLinks).toHaveLength(1);
    expect(store.posProductLinks[0]).toMatchObject({
      odoo_product_id: 1,
      link_state: "sugerido",
    });
    expect(store.posProductLinks[0].evidence).toMatchObject({
      source: "excel_import",
      tab: "DE LA PARRILLA",
      block_name: "ASADO DE PRUEBA 6",
    });
    expect(out.linked).toEqual([1]);
    const batch = store.batches.find((b) => b.id === out.result.batch_id)!;
    expect(batch.filename).toBe("costos-prueba.xlsx · recetas");
    expect(batch.undo_snapshot.created_recipe_version_ids).toHaveLength(4);
    expect(batch.undo_snapshot.created_ingredient_ids.length).toBe(
      out.result.ingredients_created
    );
    expect(canonical).toHaveLength(
      workbook.recipes.reduce((sum, r) => sum + r.lines.length, 0)
    );
    expect(canonical.every((row) => row.batch_id === out.result.batch_id)).toBe(
      true
    );
  });

  /** A dish (POS product 1) that already has a recipe, set up by `seed`. */
  async function withExisting(
    seed: (ctx: {
      store: ReturnType<typeof emptyMemoryStore>;
      repo: ReturnType<typeof createMemoryCostWorkbookRepo>;
      recipeId: string;
      menuItemId: string;
      ingredientId: string;
    }) => Promise<void>,
    choices?: Record<string, string>
  ) {
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
    const [ingredient] = await repo.createIngredients([
      {
        companyId: "co-1",
        name: "Sal mía",
        defaultUnit: "g",
        currentUnitCost: null,
        currency: "USD",
      },
    ]);
    await seed({
      store,
      repo,
      recipeId: recipe.id,
      menuItemId: menu.id,
      ingredientId: ingredient.id,
    });
    const product: PlanPosProduct = {
      odoo_product_id: 1,
      odoo_name: "Asado de Prueba (6 onz.)",
      pos_price: 14.5,
      link_state: "sin_vincular",
    };
    const state = await existingRecipeState(repo, "co-1", {
      id: recipe.id,
      source_type: "manual",
    });
    const plan = planImport({
      workbook,
      catalog: { ingredients: [], preparations: [] },
      products: [product],
      existing: [
        {
          odoo_product_id: 1,
          protected: isKeptRecipe(state),
          lines: state.lines,
        },
      ],
    });
    const out = await writeImportPlan({
      repo,
      plan,
      workbook,
      companyId: "co-1",
      currency: "USD",
      filename: "f.xlsx",
      createdBy: null,
      locationId: null,
      choices,
      insertCanonicalRows: async () => {},
    });
    const versions = store.recipeVersions.filter(
      (v) => v.recipe_id === recipe.id
    );
    return { store, out, versions, key: "ASADO DE PRUEBA 6" };
  }
  const myLine = (ingredientId: string) => ({
    input_type: "ingredient" as const,
    ingredient_id: ingredientId,
    component_id: null,
    quantity: 5,
    unit: "g",
    notes: null,
  });

  it("an empty placeholder (no lines) is filled with the Excel recipe as a new draft, counted as imported", async () => {
    const { out, versions } = await withExisting(async () => {});
    expect(versions).toHaveLength(1);
    expect(versions[0].status).toBe("in_review");
    expect(versions[0].inputs.length).toBeGreaterThan(0);
    expect(out.result.dishes_imported).toBeGreaterThanOrEqual(1);
    expect(out.result.dishes_filled).toBe(1);
    expect(out.result.dishes_kept).toBe(0);
  });

  it("a hand-made recipe with lines is kept by default: no new version", async () => {
    const { out, versions } = await withExisting(
      async ({ repo, recipeId, menuItemId, ingredientId }) => {
        await repo.insertRecipeVersion({
          companyId: "co-1",
          recipeId,
          menuItemId,
          versionNumber: 1,
          status: "in_review",
          effectiveDate: null,
          sourceType: "manual",
          inputs: [myLine(ingredientId)],
        });
      }
    );
    expect(versions).toHaveLength(1);
    expect(versions[0].source_type).toBe("manual");
    expect(out.result.dishes_kept).toBe(1);
    expect(out.result.dishes_replaced).toBe(0);
  });

  it("an approved recipe with lines is kept by default too", async () => {
    const { out, versions } = await withExisting(
      async ({ repo, recipeId, menuItemId, ingredientId }) => {
        await repo.insertRecipeVersion({
          companyId: "co-1",
          recipeId,
          menuItemId,
          versionNumber: 1,
          status: "approved",
          effectiveDate: null,
          inputs: [myLine(ingredientId)],
        });
      }
    );
    expect(versions).toHaveLength(1);
    expect(out.result.dishes_kept).toBe(1);
  });

  it("«Usar la del Excel» adds a NEW draft version and keeps the old ones (approved stays approved)", async () => {
    const { out, versions } = await withExisting(
      async ({ repo, recipeId, menuItemId, ingredientId }) => {
        await repo.insertRecipeVersion({
          companyId: "co-1",
          recipeId,
          menuItemId,
          versionNumber: 1,
          status: "approved",
          effectiveDate: null,
          inputs: [myLine(ingredientId)],
        });
      },
      { [byName("ASADO DE PRUEBA 6").key]: "excel" }
    );
    expect(versions.map((v) => [v.version_number, v.status])).toEqual([
      [1, "approved"],
      [2, "in_review"],
    ]);
    expect(versions[0].inputs).toHaveLength(1);
    expect(versions[1].inputs.length).toBeGreaterThan(1);
    expect(out.result.dishes_replaced).toBe(1);
    expect(out.result.dishes_kept).toBe(0);
    expect(out.result.dishes_imported).toBeGreaterThanOrEqual(1);
  });

  it("the new version is part of the batch, so «Deshacer lote» can remove it", async () => {
    const { store, out } = await withExisting(
      async ({ repo, recipeId, menuItemId, ingredientId }) => {
        await repo.insertRecipeVersion({
          companyId: "co-1",
          recipeId,
          menuItemId,
          versionNumber: 1,
          status: "in_review",
          effectiveDate: null,
          sourceType: "manual",
          inputs: [myLine(ingredientId)],
        });
      },
      { [byName("ASADO DE PRUEBA 6").key]: "excel" }
    );
    const batch = store.batches.find((b) => b.id === out.result.batch_id);
    const snapshot = JSON.stringify(batch);
    const created = store.recipeVersions
      .filter((v) => v.version_number === 2)
      .map((v) => v.id);
    expect(created).toHaveLength(1);
    expect(snapshot).toContain(created[0]);
  });
});

describe("Casa Piloto 1 fixes in the import", () => {
  it("a new ingredient takes the price list's unit, not a recipe line's label", () => {
    const plan = planImport({
      workbook,
      catalog: {
        ingredients: [],
        preparations: [],
        listUnits: new Map([["asado de res", "lb"]]),
      },
      products: [],
      existing: [],
    });
    expect(
      plan.ingredients.find((i) => i.name === "ASADO DE RES")?.default_unit
    ).toBe("lb");
  });

  it("links every POS variant to the same draft and marks the batch as a recipe import", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const plan = planImport({
      workbook,
      catalog: { ingredients: [], preparations: [] },
      products: [
        {
          odoo_product_id: 1,
          odoo_name: "Asado de Prueba (6 onz.) (Pan con Ajo)",
          pos_price: 14.5,
          link_state: "sin_vincular",
        },
        {
          odoo_product_id: 2,
          odoo_name: "Asado de Prueba (6 onz.) (Tortilla)",
          pos_price: 14.5,
          link_state: "sin_vincular",
        },
      ],
      existing: [],
    });
    const out = await writeImportPlan({
      repo,
      plan,
      workbook,
      companyId: "co-1",
      currency: "USD",
      filename: "f.xlsx",
      createdBy: null,
      locationId: null,
      insertCanonicalRows: async () => {},
    });
    expect(out.linked.sort()).toEqual([1, 2]);
    expect(out.result.pos_products_linked).toBe(2);
    const menuIds = new Set(store.posProductLinks.map((l) => l.menu_item_id));
    expect(menuIds.size).toBe(1);
    const batch = store.batches.find((b) => b.id === out.result.batch_id)!;
    expect(batch.undo_snapshot.recipe_import).toBe(true);
  });

  it("gives an existing draft preparation the file's sub-recipe; a hand-made one is left alone", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const draftPrep = await repo.createComponent({
      companyId: "co-1",
      name: "ACOMPAÑAMIENTO DE PRUEBA",
      outputUnit: "unit",
      sourceId: "old",
    });
    await repo.createComponentRecipe({
      companyId: "co-1",
      componentId: draftPrep.id,
      name: "ACOMPAÑAMIENTO DE PRUEBA",
      outputQuantity: 1,
      outputUnit: "unit",
      sourceId: "old",
      inputs: [],
    });
    const handmade = await repo.createComponent({
      companyId: "co-1",
      name: "CARNE DE PRUEBA 2 LIBRA",
      outputUnit: "oz",
      sourceId: "old",
    });
    store.components.find((c) => c.id === handmade.id)!.source_type = "manual";
    const plan = planImport({
      workbook,
      catalog: {
        ingredients: [],
        preparations: [
          { id: draftPrep.id, name: draftPrep.name },
          { id: handmade.id, name: handmade.name },
        ],
      },
      products: [],
      existing: [],
    });
    const out = await writeImportPlan({
      repo,
      plan,
      workbook,
      companyId: "co-1",
      currency: "USD",
      filename: "f.xlsx",
      createdBy: null,
      locationId: null,
      insertCanonicalRows: async () => {},
    });
    expect(out.result.preparations_updated).toBe(1);
    expect(
      store.componentRecipeVersions.filter(
        (v) => v.component_id === draftPrep.id
      )
    ).toHaveLength(1);
    expect(
      store.componentRecipeVersions.filter(
        (v) => v.component_id === handmade.id
      )
    ).toHaveLength(0);
  });
});

describe("re-importing never undoes a price typed by hand", () => {
  it("keeps the line's manual price, takes the rest from the Excel again", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const products = [
      {
        odoo_product_id: 1,
        odoo_name: "Asado de Prueba (6 onz.)",
        pos_price: 14.5,
        link_state: "sin_vincular",
      },
    ];
    const once = () =>
      writeImportPlan({
        repo,
        plan: planImport({
          workbook,
          catalog: {
            ingredients: store.ingredients.map((i) => ({
              id: i.id,
              name: i.name,
            })),
            preparations: store.components.map((c) => ({
              id: c.id,
              name: c.name,
            })),
          },
          products: products.map((p) => ({
            ...p,
            link_state:
              store.posProductLinks.find(
                (l) => l.odoo_product_id === p.odoo_product_id
              )?.link_state ?? p.link_state,
          })),
          existing: [],
        }),
        workbook,
        companyId: "co-1",
        currency: "USD",
        filename: "f.xlsx",
        createdBy: null,
        locationId: null,
        insertCanonicalRows: async () => {},
      });
    await once();
    const link = store.posProductLinks[0];
    const first = store.recipeVersions.find(
      (v) => v.menu_item_id === link.menu_item_id
    )!;
    // A person types 0.62 on the beef line.
    const beef = first.inputs.find((i) => i.quantity === 6)!;
    beef.unit_cost = 0.62;
    beef.cost_source = "manual";
    await once();
    const versions = store.recipeVersions
      .filter((v) => v.menu_item_id === link.menu_item_id)
      .sort((a, b) => b.version_number - a.version_number);
    expect(versions).toHaveLength(2);
    const latest = versions[0];
    expect(latest.inputs.find((i) => i.quantity === 6)).toMatchObject({
      unit_cost: 0.62,
      cost_source: "manual",
    });
    expect(
      latest.inputs.find((i) => i.input_type === "component")
    ).toMatchObject({
      unit_cost: 0.2,
      cost_source: "excel_line",
    });
  });
});
