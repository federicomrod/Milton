import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  COST_RESET_STEP_IDS,
  RESET_CONFIRM_FALLBACK,
  canManageCompanyCostReset,
  formatResetPartialFailureEs,
  multiRestaurantResetWarningEs,
  resetCompanyCostData,
  resetConfirmErrorEs,
  resetConfirmPromptEs,
  resetConfirmationAccepted,
  resetConfirmationMatches,
  runResetSteps,
} from "@/lib/restaurant/cost-workbook";
import { loadCompanyMembershipRole } from "@/lib/restaurant/cost-workbook/reset-auth";
import {
  createMemoryCostWorkbookRepo,
  emptyMemoryStore,
} from "./helpers/memory-cost-workbook-repo";
import type { CostWorkbookCostEntry } from "@/lib/restaurant/cost-workbook/types";

const COMPANY_A = "co-ranchos";
const COMPANY_B = "co-lavara";

function costEntry(
  companyId: string,
  ingredientId: string,
  sourceType: CostWorkbookCostEntry["source_type"]
): Omit<CostWorkbookCostEntry, "id" | "created_at"> {
  return {
    company_id: companyId,
    ingredient_id: ingredientId,
    supplier_id: null,
    source_type: sourceType,
    source_id: sourceType === "import" ? "batch-1" : null,
    cost_date: "2026-04-01",
    quantity: 1,
    unit: "lb",
    total_cost: 4.8,
    unit_cost: 4.8,
    normalized_unit: "lb",
    normalized_unit_cost: 4.8,
    currency: "USD",
    notes: null,
  };
}

describe("resetCompanyCostData", () => {
  it("resets only the requested company and leaves handmade menu items", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);

    const [ingA, ingAManual] = await repo.createIngredients([
      {
        companyId: COMPANY_A,
        name: "Carne ranchos",
        defaultUnit: "lb",
        currentUnitCost: 4.8,
        currency: "USD",
      },
      {
        companyId: COMPANY_A,
        name: "Tomate ranchos",
        defaultUnit: "lb",
        currentUnitCost: 1.2,
        currency: "USD",
      },
    ]);
    const [ingB] = await repo.createIngredients([
      {
        companyId: COMPANY_B,
        name: "Carne lavara",
        defaultUnit: "lb",
        currentUnitCost: 5,
        currency: "USD",
      },
    ]);

    await repo.insertCostEntries([
      costEntry(COMPANY_A, ingA.id, "import"),
      costEntry(COMPANY_A, ingAManual.id, "manual"),
      costEntry(COMPANY_B, ingB.id, "import"),
    ]);

    const importedMenuA = await repo.createMenuItem({
      companyId: COMPANY_A,
      name: "Imported taco",
      currency: "USD",
      sourceId: "batch-a",
    });
    const importedMenuB = await repo.createMenuItem({
      companyId: COMPANY_B,
      name: "Imported burger",
      currency: "USD",
      sourceId: "batch-b",
    });
    store.menuItems.push({
      id: "menu-hand-a",
      name: "Handmade ranchos plate",
      source_type: null,
      source_id: null,
    });
    store.companyByEntityId["menu-hand-a"] = COMPANY_A;

    await repo.createRecipe({
      companyId: COMPANY_A,
      menuItemId: importedMenuA.id,
      name: "Imported taco",
      sourceId: "batch-a",
      inputs: [
        {
          input_type: "ingredient",
          ingredient_id: ingA.id,
          component_id: null,
          quantity: 1,
          unit: "lb",
          notes: null,
        },
      ],
    });
    await repo.createRecipe({
      companyId: COMPANY_B,
      menuItemId: importedMenuB.id,
      name: "Imported burger",
      sourceId: "batch-b",
      inputs: [
        {
          input_type: "ingredient",
          ingredient_id: ingB.id,
          component_id: null,
          quantity: 1,
          unit: "lb",
          notes: null,
        },
      ],
    });

    const componentA = await repo.createComponent({
      companyId: COMPANY_A,
      name: "Salsa ranchos",
      outputUnit: "oz",
      sourceId: "batch-a",
    });
    await repo.createComponent({
      companyId: COMPANY_B,
      name: "Salsa lavara",
      outputUnit: "oz",
      sourceId: "batch-b",
    });

    const [mapA] = await repo.createPosMappings([
      {
        companyId: COMPANY_A,
        rawPosItemName: "TACO",
        menuItemId: importedMenuA.id,
      },
    ]);
    const [mapB] = await repo.createPosMappings([
      {
        companyId: COMPANY_B,
        rawPosItemName: "BURGER",
        menuItemId: importedMenuB.id,
      },
    ]);
    store.posMappings.push({
      id: "map-hand-a",
      raw_pos_item_name: "HAND PLATE",
      menu_item_id: "menu-hand-a",
      match_type: "manual",
    });
    store.companyByEntityId["map-hand-a"] = COMPANY_A;

    store.supplierLinks.push({
      id: "link-a",
      company_id: COMPANY_A,
      supplier_id: "sup-a",
      ingredient_id: ingA.id,
      supplier_item_name: "Carne",
      supplier_sku: null,
      preferred: true,
    });
    store.supplierLinks.push({
      id: "link-b",
      company_id: COMPANY_B,
      supplier_id: "sup-b",
      ingredient_id: ingB.id,
      supplier_item_name: "Carne",
      supplier_sku: null,
      preferred: true,
    });

    await repo.createBatch({
      companyId: COMPANY_A,
      filename: "ranchos.xlsx",
      fileMonth: "2026-04-01",
      currency: "USD",
      importedCount: 1,
      reviewCount: 0,
      tabSummaries: [],
      mappingSource: "ai",
    });
    await repo.createBatch({
      companyId: COMPANY_B,
      filename: "lavara.xlsx",
      fileMonth: "2026-04-01",
      currency: "USD",
      importedCount: 1,
      reviewCount: 0,
      tabSummaries: [],
      mappingSource: "ai",
    });

    const summary = await resetCompanyCostData(repo, COMPANY_A);

    expect(summary.ingredients).toBe(2);
    expect(summary.cost_entries).toBe(2);
    expect(summary.costing_menu_items).toBe(1);
    expect(summary.kept_manual_menu_items).toBe(1);
    expect(summary.kept_manual_pos_mappings).toBe(1);
    expect(summary.batches_marked_undone).toBe(1);

    expect(store.ingredients.map((row) => row.id)).toEqual([ingB.id]);
    expect(store.costEntries.map((row) => row.ingredient_id)).toEqual([
      ingB.id,
    ]);
    expect(store.menuItems.map((row) => row.id).sort()).toEqual(
      ["menu-hand-a", importedMenuB.id].sort()
    );
    expect(store.recipes.map((row) => row.menu_item_id)).toEqual([
      importedMenuB.id,
    ]);
    expect(store.components.map((row) => row.id)).not.toContain(componentA.id);
    expect(store.components).toHaveLength(1);
    expect(store.posMappings.map((row) => row.id).sort()).toEqual(
      ["map-hand-a", mapB.id].sort()
    );
    expect(store.posMappings.some((row) => row.id === mapA.id)).toBe(false);
    expect(store.supplierLinks.map((row) => row.id)).toEqual(["link-b"]);
    expect(
      store.batches.find((row) => row.company_id === COMPANY_A)?.undone_at
    ).toBeTruthy();
    expect(
      store.batches.find((row) => row.company_id === COMPANY_B)?.undone_at
    ).toBeNull();
  });

  it("leaves POS sales rows untouched when cost data is reset", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const [ingA] = await repo.createIngredients([
      {
        companyId: COMPANY_A,
        name: "Carne",
        defaultUnit: "lb",
        currentUnitCost: 4.8,
        currency: "USD",
      },
    ]);
    const menu = await repo.createMenuItem({
      companyId: COMPANY_A,
      name: "Taco",
      currency: "USD",
      sourceId: "batch-a",
    });
    await repo.insertCostEntries([costEntry(COMPANY_A, ingA.id, "import")]);
    store.posSalesItems.push(
      {
        id: "sale-a",
        company_id: COMPANY_A,
        raw_item_name: "TACO",
        menu_item_id: menu.id,
      },
      {
        id: "sale-b",
        company_id: COMPANY_B,
        raw_item_name: "BURGER",
        menu_item_id: null,
      }
    );

    await resetCompanyCostData(repo, COMPANY_A);

    expect(store.ingredients).toHaveLength(0);
    expect(store.menuItems).toHaveLength(0);
    expect(store.posSalesItems).toEqual([
      {
        id: "sale-a",
        company_id: COMPANY_A,
        raw_item_name: "TACO",
        menu_item_id: menu.id,
      },
      {
        id: "sale-b",
        company_id: COMPANY_B,
        raw_item_name: "BURGER",
        menu_item_id: null,
      },
    ]);
  });

  it("accepts the restaurant name case-insensitively", () => {
    expect(resetConfirmationMatches("stage test 1", "Stage Test 1")).toBe(true);
    expect(resetConfirmationMatches("  Los Ranchos ", "Los Ranchos")).toBe(
      true
    );
    expect(resetConfirmationMatches("Lavara", "Stage Test 1")).toBe(false);
  });

  it("rejects a single restaurant name when the company has two restaurants", () => {
    const target = {
      companyName: "Grupo Ranchos",
      restaurantNames: ["Los Ranchos", "Lavara"],
    };
    expect(resetConfirmationAccepted("Los Ranchos", target)).toBe(false);
    expect(resetConfirmationAccepted("Lavara", target)).toBe(false);
    expect(resetConfirmationAccepted("los ranchos", target)).toBe(false);
    expect(resetConfirmationAccepted("Grupo Ranchos", target)).toBe(true);
    expect(resetConfirmationAccepted("Los Ranchos y Lavara", target)).toBe(
      true
    );
    expect(resetConfirmationAccepted("Lavara y Los Ranchos", target)).toBe(
      true
    );
    expect(resetConfirmationAccepted("Los Ranchos, Lavara", target)).toBe(true);
  });

  it("does not treat a restaurant name as the account name on a shared company", () => {
    const target = {
      companyName: "Los Ranchos",
      restaurantNames: ["Los Ranchos", "Lavara"],
    };
    expect(resetConfirmationAccepted("Los Ranchos", target)).toBe(false);
    expect(resetConfirmationAccepted("Lavara", target)).toBe(false);
    expect(resetConfirmationAccepted("Los Ranchos y Lavara", target)).toBe(
      true
    );
  });

  it("still accepts one restaurant name when the company has only that restaurant", () => {
    expect(
      resetConfirmationAccepted("Los Ranchos", {
        companyName: "Los Ranchos",
        restaurantNames: ["Los Ranchos"],
      })
    ).toBe(true);
  });

  it("shows the explicit multi-restaurant Spanish warning", () => {
    const warning = multiRestaurantResetWarningEs(
      ["Los Ranchos", "Lavara"],
      "Los Ranchos"
    );
    expect(warning).toBe(
      "Esto borra los costos y recetas de TODOS los restaurantes de la cuenta (Los Ranchos y Lavara), no solo de Los Ranchos. No se puede deshacer."
    );
    expect(
      resetConfirmPromptEs({
        companyName: "Los Ranchos",
        restaurantNames: ["Los Ranchos", "Lavara"],
      })
    ).toContain("Los Ranchos y Lavara");
    expect(
      resetConfirmPromptEs({
        companyName: "Los Ranchos",
        restaurantNames: ["Los Ranchos", "Lavara"],
      })
    ).toContain("No se puede deshacer");
    expect(
      resetConfirmErrorEs({
        companyName: "Grupo Ranchos",
        restaurantNames: ["Los Ranchos", "Lavara"],
      })
    ).toBe(
      "Escribe el nombre de la cuenta o el de todos los restaurantes para confirmar."
    );
  });

  it("matches both restaurant names even when one name contains y", () => {
    const target = {
      companyName: "Grupo Ranchos",
      restaurantNames: ["Los Ranchos", "Pollo y Más"],
    };
    expect(resetConfirmationAccepted("Los Ranchos y Pollo y Más", target)).toBe(
      true
    );
    expect(resetConfirmationAccepted("Pollo y Más y Los Ranchos", target)).toBe(
      true
    );
    expect(resetConfirmationAccepted("Pollo y Más", target)).toBe(false);
    expect(resetConfirmationAccepted("Los Ranchos", target)).toBe(false);
  });

  it("does not accept START OVER when a restaurant or account name exists", () => {
    expect(
      resetConfirmationAccepted("START OVER", {
        companyName: "Los Ranchos",
        restaurantNames: ["Los Ranchos"],
      })
    ).toBe(false);
    expect(
      resetConfirmationAccepted("EMPEZAR DE NUEVO", {
        companyName: "Los Ranchos",
        restaurantNames: ["Los Ranchos"],
      })
    ).toBe(false);
    expect(RESET_CONFIRM_FALLBACK).toBe("EMPEZAR DE NUEVO");
    expect(
      resetConfirmationAccepted("EMPEZAR DE NUEVO", {
        companyName: null,
        restaurantNames: [],
      })
    ).toBe(true);
  });

  it("runs every step even when one fails, and reports each with its count (#188)", async () => {
    const called: string[] = [];
    const steps = await runResetSteps(async (id) => {
      called.push(id);
      if (id === "ingredients") throw new Error("ingredients blocked");
      if (id === "recipes") return 3;
      return 0;
    });
    const failed = steps.find((step) => step.id === "ingredients");
    const recipes = steps.find((step) => step.id === "recipes");
    const batches = steps.find((step) => step.id === "batches_marked_undone");
    expect(recipes).toEqual(
      expect.objectContaining({
        status: "completed",
        deleted: 3,
      })
    );
    expect(failed).toEqual(
      expect.objectContaining({
        status: "failed",
        deleted: 0,
        error: "ingredients blocked",
      })
    );
    // A failure never stops the rest: review rows, links and the archive
    // still get cleared.
    expect(batches?.status).toBe("completed");
    expect(called).toEqual([...COST_RESET_STEP_IDS]);
    expect(called[0]).toBe("cost_import_review_items");
    const message = formatResetPartialFailureEs(steps);
    expect(message).toContain("El reinicio quedó a medias");
    expect(message).toContain("Vuelve a pulsar para terminar");
    expect(message).toContain("recetas y sus versiones (3)");
    expect(message).toContain("ingredientes (ingredients blocked)");
    expect(message).toContain("no se puede deshacer");
    expect(message).not.toContain("Pasos que no se corrieron");
  });

  it("returns per-step counts when a catalog reset fails halfway and a re-run finishes", async () => {
    const store = emptyMemoryStore();
    const repo = createMemoryCostWorkbookRepo(store);
    const [ingA] = await repo.createIngredients([
      {
        companyId: COMPANY_A,
        name: "Carne",
        defaultUnit: "lb",
        currentUnitCost: 4.8,
        currency: "USD",
      },
    ]);
    await repo.insertCostEntries([costEntry(COMPANY_A, ingA.id, "import")]);
    await repo.createBatch({
      companyId: COMPANY_A,
      filename: "ranchos.xlsx",
      fileMonth: "2026-04-01",
      currency: "USD",
      importedCount: 1,
      reviewCount: 0,
      tabSummaries: [],
      mappingSource: "ai",
    });
    store.failResetStep = "ingredients";

    const first = await resetCompanyCostData(repo, COMPANY_A);
    expect(first.ok).toBe(false);
    expect(first.cost_entries).toBe(1);
    expect(first.ingredients).toBe(0);
    expect(store.ingredients).toHaveLength(1);
    expect(store.costEntries).toHaveLength(0);
    const failed = first.steps.find((step) => step.id === "ingredients");
    const costs = first.steps.find(
      (step) => step.id === "ingredient_cost_entries"
    );
    const batches = first.steps.find(
      (step) => step.id === "batches_marked_undone"
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("ingredients");
    expect(costs?.status).toBe("completed");
    expect(costs?.deleted).toBe(1);
    expect(batches?.status).toBe("completed");

    store.failResetStep = undefined;
    const second = await resetCompanyCostData(repo, COMPANY_A);
    expect(second.ok).toBe(true);
    expect(second.ingredients).toBe(1);
    expect(second.cost_entries).toBe(0);
    expect(store.ingredients).toHaveLength(0);
    expect(second.steps.every((step) => step.status === "completed")).toBe(
      true
    );
  });

  it("allows owner/admin and denies member or a missing role", () => {
    expect(canManageCompanyCostReset({ role: "owner" })).toBe(true);
    expect(canManageCompanyCostReset({ role: "admin" })).toBe(true);
    expect(canManageCompanyCostReset({ role: "manager" })).toBe(false);
    expect(canManageCompanyCostReset({ role: "member" })).toBe(false);
    expect(canManageCompanyCostReset({ role: "viewer" })).toBe(false);
    expect(canManageCompanyCostReset({ role: null })).toBe(false);
    expect(canManageCompanyCostReset({ role: undefined })).toBe(false);
  });

  it("denies a membership read error even when the message contains role", async () => {
    const supabase = {
      from() {
        return this;
      },
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: async () => ({
        data: null,
        error: { message: 'role "authenticator" does not exist' },
      }),
    };
    await expect(
      loadCompanyMembershipRole(supabase as never, "co-ranchos", "user-1")
    ).rejects.toThrow(/role "authenticator"/);
    expect(canManageCompanyCostReset({ role: null })).toBe(false);
  });
});

describe("cost reset server and UI copy", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

  it("enforces the multi-restaurant confirm on the reset route", () => {
    const src = read("app/api/restaurant/costs/reset/route.ts");
    expect(src).toContain("resetConfirmationAccepted");
    expect(src).toContain("loadCompanyName");
    expect(src).toContain("restaurantContext.locations.map");
    expect(src).not.toContain("Type the restaurant name to confirm");
    expect(src).not.toContain('error: "Reset failed"');
    expect(src).not.toContain("error_en");
    expect(src).toContain("RESET_FAILED_ERROR_ES");
    expect(src).toContain("canManageCompanyCostReset");
  });

  it("Empezar de nuevo lives in Recetas y costeo, owner/admin only, with typed confirmation", () => {
    const src = read("components/restaurant/recipes-costing/ResetPanel.tsx");
    expect(src).toContain("formatResetPartialFailureEs");
    expect(src).toContain("disabled={busy || !typed.trim()}");
    expect(src).toContain("/api/restaurant/costs/reset");
    expect(src).toContain("No se toca:");
    expect(src).not.toContain("t(lang");
    expect(src).not.toContain("error_en");
    const server = read("lib/restaurant/recipe-costing/workspace-server.ts");
    expect(server).toContain("canManageCompanyCostReset(roleLoad)");
    expect(server).toContain("multiRestaurantResetWarningEs");
    expect(server).toContain("resetConfirmPromptEs");
    const resumen = read(
      "components/restaurant/recipes-costing/ResumenScreen.tsx"
    );
    expect(resumen).toContain("data.reset ? (");
  });

  it("does not bypass the role check on a column-missing heuristic", () => {
    const auth = read("lib/restaurant/cost-workbook/reset-auth.ts");
    expect(auth).not.toContain("roleColumnMissing");
    expect(auth).not.toContain("errorMentionsColumn");
    const reset = read("lib/restaurant/cost-workbook/reset.ts");
    expect(reset).not.toContain("roleColumnMissing");
    expect(reset).toContain('role === "owner" || input.role === "admin"');
  });
});
