// PR C: one way into recipes and costs, and a reset that really starts
// over. Synthetic data only.

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { resetCompanyCostData } from "@/lib/restaurant/cost-workbook";
import { COST_RESET_STEP_IDS } from "@/lib/restaurant/cost-workbook/reset";
import {
  unlinkedPosProduct,
  suggestPosProductLink,
} from "@/lib/restaurant/pos-product-links";
import { LEGACY_ROUTE_MAP } from "@/lib/restaurant/navigation";
import {
  MENU_PATH,
  PLATOS_PATH,
  PREPARACIONES_PATH,
  recetasHref,
} from "@/lib/restaurant/recetas-redirect";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CO = "co-1";
const OTHER = "co-2";

async function seeded() {
  const store = emptyMemoryStore();
  const repo = createMemoryCostWorkbookRepo(store);
  const [ing] = await repo.createIngredients([
    {
      companyId: CO,
      name: "Harina",
      defaultUnit: "oz",
      currentUnitCost: 0.1,
      currency: "USD",
    },
  ]);
  await repo.upsertIngredientAlias({
    companyId: CO,
    aliasName: "HARINA DE TRIGO",
    ingredientId: ing!.id,
    createdBy: "u",
  });
  // A menu item the costing flow made (dish preparation: source "import"),
  // linked from a POS product…
  const linkedMenu = await repo.createMenuItem({
    companyId: CO,
    name: "Plato de prueba",
    currency: "USD",
    sourceId: "b1",
  });
  const recipe = await repo.createRecipe({
    companyId: CO,
    menuItemId: linkedMenu.id,
    name: "Plato de prueba",
    sourceId: "b1",
    inputs: [],
  });
  await repo.insertRecipeVersion({
    companyId: CO,
    recipeId: recipe.id,
    menuItemId: linkedMenu.id,
    versionNumber: 1,
    status: "in_review",
    effectiveDate: null,
    sourceType: "import",
    notes: null,
    inputs: [],
  });
  await repo.upsertPosProductLink(
    CO,
    suggestPosProductLink(
      unlinkedPosProduct({
        company_id: CO,
        odoo_product_id: 7,
        odoo_name: "Plato de prueba",
      }),
      { menu_item_id: linkedMenu.id, evidence: { source: "ai" } }
    )
  );
  // …and one it did not make (by hand, a POS upload or Ask Milton), which
  // a person later linked to a POS product and gave a recipe draft. It is
  // kept, with its manual POS mapping; its recipe and link are cleared.
  store.menuItems.push({
    id: "menu-hand",
    name: "Platillo hecho a mano",
    source_type: null,
    source_id: null,
    location_id: null,
    brand_id: null,
    selling_price: 5,
  });
  store.companyByEntityId["menu-hand"] = CO;
  store.posMappings.push({
    id: "map-hand",
    raw_pos_item_name: "PLATILLO HECHO A MANO",
    menu_item_id: "menu-hand",
    match_type: "manual",
  });
  store.companyByEntityId["map-hand"] = CO;
  const handRecipe = await repo.createRecipe({
    companyId: CO,
    menuItemId: "menu-hand",
    name: "Platillo hecho a mano",
    sourceId: "b1",
    inputs: [],
  });
  await repo.insertRecipeVersion({
    companyId: CO,
    recipeId: handRecipe.id,
    menuItemId: "menu-hand",
    versionNumber: 1,
    status: "in_review",
    effectiveDate: null,
    sourceType: "manual",
    notes: null,
    inputs: [],
  });
  await repo.upsertPosProductLink(
    CO,
    suggestPosProductLink(
      unlinkedPosProduct({
        company_id: CO,
        odoo_product_id: 8,
        odoo_name: "Platillo hecho a mano",
      }),
      { menu_item_id: "menu-hand", evidence: { source: "manual_pick" } }
    )
  );
  // Another company's link is never touched.
  await repo.upsertPosProductLink(
    OTHER,
    unlinkedPosProduct({
      company_id: OTHER,
      odoo_product_id: 9,
      odoo_name: "Otro",
    })
  );
  await repo.createBatch({
    companyId: CO,
    filename: "costos.xlsx",
    fileMonth: null,
    currency: "USD",
    importedCount: 1,
    reviewCount: 0,
    tabSummaries: [],
    mappingSource: "mixed",
  });
  await repo.insertReviewItems([
    {
      company_id: CO,
      batch_id: store.batches[0]!.id,
      tab_name: "Lista",
      row_index: 3,
      reason: "Falta confirmar la unidad de esta fila.",
      raw_values: { kind: "catalog_row", name: "Mango" },
      suggested: null,
      status: "pending",
    },
  ]);
  return { store, repo };
}

describe("Empezar de nuevo clears the whole costing setup", () => {
  it("leaves nothing a fresh upload could pick up, and keeps what costing did not make", async () => {
    const { store, repo } = await seeded();
    const summary = await resetCompanyCostData(repo, CO);
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({
      ingredients: 1,
      ingredient_aliases: 1,
      pos_product_links: 2,
      costing_menu_items: 1,
      recipes: 2,
      review_items: 1,
      batches_marked_undone: 1,
      kept_manual_menu_items: 1,
    });
    expect(store.ingredients).toHaveLength(0);
    expect(store.aliases).toHaveLength(0);
    expect(store.recipes).toHaveLength(0);
    expect(store.recipeVersions).toHaveLength(0);
    expect(store.reviewItems).toHaveLength(0);
    // (b) the costing-made menu item is deleted; (a) the hand-made one is
    // kept even though it was linked, and so is its manual POS mapping.
    expect(store.menuItems.map((m) => m.id)).toEqual(["menu-hand"]);
    expect(store.posMappings.map((m) => m.id)).toEqual(["map-hand"]);
    expect(store.posProductLinks.map((l) => l.company_id)).toEqual([OTHER]);
    // Uploads stay as an archive (who uploaded what, when), never live.
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]!.undone_at).not.toBeNull();
  });

  it("clears review rows first, so an early failure can never leave them (#188)", () => {
    expect(COST_RESET_STEP_IDS[0]).toBe("cost_import_review_items");
    expect(COST_RESET_STEP_IDS).toContain("pos_product_links");
    expect(COST_RESET_STEP_IDS).toContain("ingredient_aliases");
    expect(COST_RESET_STEP_IDS).toContain("costing_menu_items");
  });

  it("never touches POS sales or the Odoo connection", () => {
    const repo = read("lib/restaurant/cost-workbook/repo.ts");
    const reset = repo.slice(
      repo.indexOf("async function resetSupabaseCompanyCostCatalog("),
      repo.indexOf("export function createSupabaseCostWorkbookRepo(")
    );
    expect(reset).not.toMatch(/pos_sales|odoo_connections|odoo_/);
    expect(reset).toContain('"pos_product_links"');
    expect(reset).toContain('"ingredient_aliases"');
  });
});

describe("one way in: old pages redirect to Recetas y costeo", () => {
  it("builds the target link", () => {
    // R1-09b: the old Recetas views are Menú tabs now.
    expect(recetasHref({})).toBe(MENU_PATH);
    expect(recetasHref({ vista: "preparaciones", prep: "c1" })).toBe(
      `${PREPARACIONES_PATH}?prep=c1`
    );
    expect(recetasHref({ vista: "plato", producto: 7, location: "l1" })).toBe(
      `${PLATOS_PATH}?producto=7&location=l1`
    );
  });

  it("the old pages are redirects, not screens", () => {
    // R1-09b (A9): the old cost upload lands on Menú › Resumen.
    const costsUpload = read("app/dashboard/restaurant/costs/upload/page.tsx");
    expect(costsUpload).toContain("redirect(hrefKeepingParams(MENU_HREF");
    expect(costsUpload).not.toMatch(/<[A-Z]\w*[\s/>]/);
    for (const page of [
      "app/dashboard/restaurant/components/[id]/page.tsx",
      "app/dashboard/restaurant/menu/[id]/page.tsx",
    ]) {
      const src = read(page);
      expect(src, page).toContain("redirect(recetasHref(");
      expect(src, page).not.toMatch(/<[A-Z]\w+/);
    }
    for (const gone of [
      "app/dashboard/restaurant/costs/upload/upload-form.tsx",
      "app/dashboard/restaurant/costs/upload/import-history.tsx",
      "components/restaurant/MenuRecipesPage.tsx",
      "app/api/restaurant/recipes/approve/route.ts",
      "app/api/restaurant/recipes/submit/route.ts",
      "app/api/restaurant/pos/links/confirm/route.ts",
    ]) {
      expect(existsSync(join(process.cwd(), gone)), gone).toBe(false);
    }
  });

  it("navigation sends the old cost upload to Menú, outside Configuración", () => {
    const importCosts = LEGACY_ROUTE_MAP.find((r) => r.id === "import-costs");
    expect(importCosts?.href).toBe("/dashboard/restaurant/costs/upload");
    expect(importCosts?.resolvesTo).toBe(MENU_PATH);
    expect(importCosts?.section).toBeUndefined();
  });

  it("Menú › Resumen (profitability) stays", () => {
    expect(read("app/dashboard/restaurant/menu/page.tsx")).toContain(
      "MenuProfitabilityTab"
    );
  });
});
