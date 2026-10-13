// PR B: one upload that never blocks, unclear price-list rows asked on the
// dish that uses them, and the Resumen checklist / coverage goal.
// Synthetic names and prices only.

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { undoCostImportBatch } from "@/lib/restaurant/cost-workbook";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import {
  CATALOG_ROW_KIND,
  answerCatalogRow,
  applyPriceCatalog,
} from "@/lib/restaurant/price-catalog/apply";
import { readPriceCatalog } from "@/lib/restaurant/price-catalog/reader";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { buildRecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const COMPANY = "co-1";
const FILE = "Costos de prueba_Abril-2026.xlsx";

function sheet(): unknown[][] {
  return [
    ["ITEM", "LIBRA", "ONZA", "PRECIO\n UNITARIO"],
    ["VERDURAS"],
    ["Betabel", 0.48, 0.03, ""],
    // 1.44 / 0.12 = 12: per ounce, or per piece of a 12-piece pack?
    ["Pan de molde 12 rebanadas", 1.44, 0.12, ""],
    // LIBRA/UNIDAD: per pound or per piece?
    ["Mango", "LIBRA/ UNIDAD", 1.8, 0.45],
    ["Salsa rota", "PRECIO POR ONZA", "", "#ERROR!"],
  ];
}

async function upload() {
  const store = emptyMemoryStore();
  const repo = createMemoryCostWorkbookRepo(store);
  const result = await applyPriceCatalog({
    repo,
    companyId: COMPANY,
    userId: "u1",
    currency: "USD",
    filename: FILE,
    read: readPriceCatalog("Lista", sheet())!,
    observations: [],
    // Nobody answered anything: the upload still goes through.
    decisions: {},
  });
  return { store, repo, result };
}

const question = (store: ReturnType<typeof emptyMemoryStore>, name: string) =>
  store.reviewItems.find(
    (r) =>
      (r.raw_values as Record<string, unknown>).kind === CATALOG_ROW_KIND &&
      (r.raw_values as Record<string, unknown>).name === name
  )!;

describe("Subir Excel de costos: nothing uncertain blocks it", () => {
  it("saves what is clear and keeps unclear rows as questions, adding no ingredient for them", async () => {
    const { store, result } = await upload();
    const names = store.ingredients.map((i) => i.name);
    expect(names).toEqual(["Betabel"]);
    expect(result.saved).toBe(1);
    expect(result.pending_rows).toBe(3);
    const pan = question(store, "Pan de molde 12 rebanadas");
    expect(pan.raw_values).toMatchObject({
      kind: CATALOG_ROW_KIND,
      ingredient_id: null,
      status: "check_unit",
      sheet: "Lista",
    });
    const units = (
      pan.raw_values.options as Array<{ unit: string; unit_cost: number }>
    ).map((o) => o.unit);
    expect(units.sort()).toEqual(["oz", "unit"]);
    // A broken price cell is kept too, with no reading to offer.
    expect(question(store, "Salsa rota").raw_values.options).toEqual([]);
  });

  it("the person's pick adds the ingredient in that unit, with the file's price and provenance", async () => {
    const { store, repo, result } = await upload();
    const pan = question(store, "Pan de molde 12 rebanadas");
    const r = await answerCatalogRow({
      repo,
      companyId: COMPANY,
      currency: "USD",
      reviewId: pan.id,
      unit: "unit",
    });
    expect(r.ok).toBe(true);
    const ing = store.ingredients.find(
      (i) => i.name === "Pan de molde 12 rebanadas"
    )!;
    expect(ing.default_unit).toBe("unit");
    const cost = store.costEntries.find((e) => e.ingredient_id === ing.id)!;
    expect(cost).toMatchObject({
      currency: "USD",
      source_id: result.batch_id,
      cost_date: "2026-04-01",
      date_source: "dated_price_list",
    });
    expect(cost.notes).toMatch(/Lista · fila \d+ \(unidad confirmada\)/);
    expect(question(store, "Pan de molde 12 rebanadas").status).toBe(
      "approved"
    );

    // Answering twice, or with a reading that is not in the file, is refused.
    const again = await answerCatalogRow({
      repo,
      companyId: COMPANY,
      currency: "USD",
      reviewId: pan.id,
      unit: "unit",
    });
    expect(again.ok).toBe(false);
    const mango = question(store, "Mango");
    const wrong = await answerCatalogRow({
      repo,
      companyId: COMPANY,
      currency: "USD",
      reviewId: mango.id,
      unit: "g",
    });
    expect(wrong.ok).toBe(false);

    // Undoing the upload removes the picked ingredient and its price too.
    const undone = await undoCostImportBatch(repo, COMPANY, result.batch_id);
    expect(undone.ok).toBe(true);
    expect(store.ingredients).toHaveLength(0);
    expect(store.costEntries).toHaveLength(0);
  });
});

describe("the question shows on the dish line that uses the row", () => {
  function dish() {
    return memoryEditorState({
      ingredients: [{ id: "i-betabel", name: "Betabel", default_unit: "oz" }],
      entries: [entry("i-betabel", "oz", 0.03)],
      version: {
        id: "v1",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m1",
      },
      link: {
        id: "link-1",
        menu_item_id: "m1",
        evidence: {
          yield: { value: 1, unit: "porción", source: "excel" },
          lines: [
            {
              source_row: 5,
              raw_name: "PAN DE MOLDE 12 REBANADAS",
              ingredient_match: null,
              sub_recipe_match: null,
              qty: 2,
              unit: "unit",
              unit_cost: null,
              pending: true,
              flags: ["pendiente_ingrediente"],
              reasons: [],
            },
          ],
        },
      },
      catalogRows: [
        {
          id: "q-pan",
          name: "Pan de molde 12 rebanadas",
          ingredient_id: null,
          reason: "Falta confirmar la unidad de esta fila.",
          options: [
            { unit: "oz", unit_cost: 0.12 },
            { unit: "unit", unit_cost: 0.12 },
          ],
          status: "pending",
        },
      ],
    });
  }
  const ctx = (s: ReturnType<typeof dish>) => ({
    store: createMemoryEditorStore(s),
    companyId: "co-1",
    odooProductId: 7,
    locationId: null,
    userId: "u1",
  });

  it("offers the file's readings on the unresolved line", async () => {
    const r = await loadEditor(ctx(dish()));
    if (!r.ok) throw new Error(r.error);
    const line = r.state.lines.find((l) => l.kind === "unresolved")!;
    expect(line.catalog_question).toMatchObject({
      item_id: "q-pan",
      options: [
        { unit: "oz", unit_cost: 0.12 },
        { unit: "unit", unit_cost: 0.12 },
      ],
    });
    // Until then the line stays pending: never $0.
    expect(line.amount).toBeNull();
  });

  it("one click adds the ingredient, its price, and the line to the recipe", async () => {
    const s = dish();
    const loaded = await loadEditor(ctx(s));
    if (!loaded.ok) throw new Error(loaded.error);
    const line = loaded.state.lines.find((l) => l.kind === "unresolved")!;
    const r = await applyEdit(ctx(s), {
      action: "answer_catalog_unit",
      item_id: "q-pan",
      unit: "unit",
      line_key: line.key,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const added = s.ingredients.find(
      (i) => i.name === "Pan de molde 12 rebanadas"
    )!;
    expect(added.default_unit).toBe("unit");
    expect(s.inputs.at(-1)).toMatchObject({
      ingredient_id: added.id,
      quantity: 2,
      unit: "unit",
    });
    const now = r.state.lines.find((l) => l.ingredient_id === added.id)!;
    expect(now.pending).toBe(false);
    expect(now.amount).toBeCloseTo(0.24, 6);
  });
  it("Ninguna (dejar Pendiente) closes the question and adds nothing", async () => {
    const s = dish();
    const loaded = await loadEditor(ctx(s));
    if (!loaded.ok) throw new Error(loaded.error);
    const line = loaded.state.lines.find((l) => l.kind === "unresolved")!;
    const r = await applyEdit(ctx(s), {
      action: "answer_catalog_unit",
      item_id: "q-pan",
      unit: "none",
      line_key: line.key,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.catalogRows?.[0].status).toBe("skipped");
    expect(s.ingredients).toHaveLength(1);
    expect(s.inputs).toHaveLength(0);
    const after = r.state.lines.find((l) => l.raw_name === line.raw_name)!;
    expect(after.pending).toBe(true);
    expect(after.amount).toBeNull();
    expect(after.catalog_question ?? null).toBeNull();
  });
});

function product(
  id: number,
  name: string,
  net: number,
  partial: Partial<RankedPosProduct> = {}
): RankedPosProduct {
  return {
    odoo_product_id: id,
    odoo_name: name,
    net_sales: net,
    share_of_net_sales: net / 100,
    share_of_food_sales: net / 100,
    units_sold: 1,
    category: null,
    is_combo: false,
    components: [],
    excluded_parts: [],
    classification: "plato_preparado",
    classification_label: "",
    treatment: "plato_preparado",
    suggested_treatment: null,
    in_food_sales: TREATMENT_RULES.plato_preparado.in_food_sales,
    link_state: "sin_vincular",
    link_state_label: "",
    menu_item_id: null,
    counts_toward_coverage: false,
    ...partial,
  };
}

function resumen(opts: {
  products: RankedPosProduct[];
  coveragePct: number;
  upload?: boolean;
}) {
  return buildRecipeCostingWorkspace({
    companyId: "co",
    companyName: null,
    currency: "USD",
    periodLabel: null,
    view: "resumen",
    actor: { user_id: "u", role: "owner", is_milton_staff: false },
    products: opts.products,
    links: [],
    versions: [],
    menuItems: [],
    batches: [],
    coveragePct: opts.coveragePct,
    netSales: 100,
    coveredNetSales: opts.coveragePct,
    latestUpload: opts.upload
      ? {
          id: "b1",
          filename: "costos.xlsx",
          created_at: null,
          has_candidate_blocks: true,
        }
      : null,
  });
}

describe("Resumen: checklist, coverage goal, Continuar", () => {
  it("checks POS, the cost file and linked dishes", () => {
    const empty = resumen({ products: [], coveragePct: 0 });
    expect(empty.setup_checklist.map((c) => [c.id, c.done])).toEqual([
      ["pos", false],
      ["excel", false],
      ["platos", false],
    ]);
    const started = resumen({
      products: [product(1, "Pollo", 60), product(2, "Sopa", 40)],
      coveragePct: 0,
      upload: true,
    });
    expect(started.setup_checklist.map((c) => c.done)).toEqual([
      true,
      true,
      false,
    ]);
    expect(started.setup_checklist[2]!.detail).toBe(
      "0 de 2 vinculados · 0 aprobados"
    );
  });

  it("marks the 90% goal on food sales and never treats it as a stop", () => {
    const below = resumen({
      products: [product(1, "Pollo", 60)],
      coveragePct: 72,
    });
    expect(below.coverage).toMatchObject({ goal_pct: 90, goal_reached: false });
    expect(below.coverage.goal_note).toMatch(/90% de las ventas de comida/);
    const above = resumen({
      products: [product(1, "Pollo", 60), product(2, "Sopa", 40)],
      coveragePct: 92,
    });
    expect(above.coverage.goal_reached).toBe(true);
    expect(above.coverage.goal_note).toMatch(/Puedes seguir/);
    // Still a next dish to do: Continuar keeps going past the goal.
    expect(above.next_dish?.label).toBe("Continuar: Pollo →");
  });

  it("Continuar opens the top-selling dish still to do in Plato por plato", () => {
    const ws = resumen({
      products: [product(1, "Pollo", 60), product(2, "Sopa", 40)],
      coveragePct: 0,
    });
    expect(ws.next_dish).toMatchObject({ odoo_product_id: 1, view: "plato" });
  });
});

describe("one upload on screen", () => {
  it("Resumen has no second upload or generate button", () => {
    const ui = read("components/restaurant/recipes-costing/ResumenScreen.tsx");
    expect(ui).not.toContain('type="file"');
    expect(ui).toContain("onUploaded");
    const panel = read(
      "components/restaurant/recipes-costing/PriceCatalogPanel.tsx"
    );
    expect(panel).toContain(
      "const canSave = !!draftName && !!preview && !busy && !busyExternal;"
    );
    expect(panel).toContain("onUploaded?.()");
  });
});
