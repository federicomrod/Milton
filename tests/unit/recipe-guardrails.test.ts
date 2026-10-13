// Premise 5: nothing becomes a trusted ingredient by being typed or
// imported as a recipe line. Synthetic names only — no client data.

import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  matchExistingIngredient,
  unmatchedIngredientMessage,
  type CatalogIngredientRef,
} from "@/lib/restaurant/recipe-costing/ingredient-match";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const catalog: CatalogIngredientRef[] = [
  { id: "i-emp", name: "EMPANIZADOR", default_unit: "lb" },
  { id: "i-queso", name: "Queso cremado", default_unit: "oz" },
  { id: "i-aceite-1", name: "Aceite", default_unit: "oz" },
  { id: "i-aceite-2", name: "ACEITE", default_unit: "oz" },
];

describe("matchExistingIngredient", () => {
  it("matches case, accents and spacing exactly", () => {
    const hit = matchExistingIngredient("  queso  CREMADO ", catalog);
    expect(hit.kind).toBe("exact");
    if (hit.kind === "exact") expect(hit.ingredient.id).toBe("i-queso");
  });

  it("offers a typo as a possible match, never as an exact one", () => {
    const hit = matchExistingIngredient("EMPANIZAOR", catalog);
    expect(hit.kind).toBe("possible");
    if (hit.kind === "possible") {
      expect(hit.ingredient.name).toBe("EMPANIZADOR");
      expect(unmatchedIngredientMessage("EMPANIZAOR", hit)).toContain(
        "¿Quisiste decir «EMPANIZADOR»?"
      );
    }
  });

  it("refuses to guess between two same-named ingredients", () => {
    expect(matchExistingIngredient("aceite", catalog).kind).toBe("ambiguous");
  });

  it("does not treat SQL wildcards as a match", () => {
    expect(matchExistingIngredient("%", catalog).kind).toBe("none");
    expect(matchExistingIngredient("_", catalog).kind).toBe("none");
    expect(matchExistingIngredient("", catalog).kind).toBe("none");
  });

  it("returns none for a genuinely unknown name", () => {
    expect(matchExistingIngredient("Hierba rara", catalog).kind).toBe("none");
  });
});

// ---- applyReviewFix: a typed price must never create an ingredient ----

interface Write {
  table: string;
  op: "insert" | "update";
  payload: unknown;
}

const writes: Write[] = [];

vi.mock("@/lib/restaurant/recipe-costing/link-actions-server", () => ({
  loadPosProductLink: vi.fn(async () => ({
    id: "link-1",
    company_id: "co-1",
    location_id: null,
    odoo_product_id: 7,
    odoo_name: "Plato de prueba",
    classification: "requiere_receta",
    menu_item_id: null,
    link_state: "sugerido",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {
      lines: [
        {
          raw_name: "EMPANIZAOR",
          qty: 1,
          unit: "oz",
          unit_cost: null,
          pending: true,
          flags: ["pendiente_costo"],
          reasons: [],
          source_row: 4,
        },
        {
          raw_name: "Queso cremado",
          qty: 1,
          unit: "oz",
          unit_cost: null,
          pending: true,
          flags: ["pendiente_costo"],
          reasons: [],
          source_row: 5,
        },
      ],
    },
  })),
}));

let ingredientRows: CatalogIngredientRef[] = [];

vi.mock("@/lib/restaurant/paginated-read", () => ({
  fetchAllRows: vi.fn(async () => ({
    rows: ingredientRows,
    truncated: false,
    error: null,
  })),
}));

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: vi.fn(async () => "USD"),
}));

function fakeSupabase() {
  const chain = (table: string) => {
    const api: Record<string, unknown> = {};
    const self = () => api;
    for (const name of ["select", "eq", "order", "limit", "ilike", "in"]) {
      api[name] = self;
    }
    api.insert = (payload: unknown) => {
      writes.push({ table, op: "insert", payload });
      return Promise.resolve({ data: null, error: null });
    };
    api.update = (payload: unknown) => {
      writes.push({ table, op: "update", payload });
      return api;
    };
    api.maybeSingle = async () => ({ data: null, error: null });
    api.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: [], error: null });
    return api;
  };
  return { from: (table: string) => chain(table) } as never;
}

describe("applyReviewFix typed price", () => {
  beforeEach(() => {
    writes.length = 0;
    ingredientRows = catalog.slice(0, 2);
  });

  it("writes nothing and suggests the catalog match for a typo", async () => {
    const { applyReviewFix } =
      await import("@/lib/restaurant/recipe-costing/review-server");
    const result = await applyReviewFix({
      supabase: fakeSupabase(),
      companyId: "co-1",
      odooProductId: 7,
      sourceRow: 4,
      rawName: "EMPANIZAOR",
      unitCost: 0.11,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("EMPANIZADOR");
    }
    expect(writes).toEqual([]);
  });

  it("writes nothing for a wildcard-looking name", async () => {
    const { applyReviewFix } =
      await import("@/lib/restaurant/recipe-costing/review-server");
    const result = await applyReviewFix({
      supabase: fakeSupabase(),
      companyId: "co-1",
      odooProductId: 7,
      addLine: true,
      rawName: "%",
      unitCost: 1,
    });
    // add_line only adds a pending line; it never prices or creates.
    expect(result.ok).toBe(true);
    expect(writes.some((w) => w.table === "ingredients")).toBe(false);
    expect(writes.some((w) => w.table === "ingredient_cost_entries")).toBe(
      false
    );
  });

  it("prices only an ingredient that already exists, and never inserts one", async () => {
    const { applyReviewFix } =
      await import("@/lib/restaurant/recipe-costing/review-server");
    const result = await applyReviewFix({
      supabase: fakeSupabase(),
      companyId: "co-1",
      odooProductId: 7,
      sourceRow: 5,
      rawName: "Queso cremado",
      unit: "oz",
      unitCost: 0.21,
    });
    expect(result.ok).toBe(true);
    expect(
      writes.filter((w) => w.table === "ingredients" && w.op === "insert")
    ).toEqual([]);
    const entry = writes.find(
      (w) => w.table === "ingredient_cost_entries" && w.op === "insert"
    );
    expect((entry?.payload as { ingredient_id: string }).ingredient_id).toBe(
      "i-queso"
    );
  });
});

describe("no silent ingredient creation (source guards)", () => {
  it("recipe persistence has no ingredient-creation path", () => {
    const src = read("lib/restaurant/cost-workbook/persist-recipes.ts");
    expect(src).not.toContain("createIngredients");
    expect(src).not.toContain("ensureIngredientsFromRecipeLines");
    expect(src).not.toContain("createMissingIngredients");
  });

  it("review-server never inserts into ingredients", () => {
    const src = read("lib/restaurant/recipe-costing/review-server.ts");
    expect(src).not.toMatch(/from\("ingredients"\)\s*\.insert/);
    expect(src).not.toContain(".ilike(");
  });

  it("the Costos upload form no longer pre-ticks the create box", () => {
    const src = read("app/dashboard/restaurant/costs/upload/upload-form.tsx");
    expect(src).toContain("useState(false)");
    expect(src).not.toMatch(
      /\[createMissing, setCreateMissing\] = useState\(true\)/
    );
  });

  it("the Costos route does not hand the flag to the workbook importer", () => {
    const src = read("app/api/restaurant/costs/upload/route.ts");
    const call = src.slice(src.indexOf("importCostWorkbook({"));
    const body = call.slice(0, call.indexOf("});"));
    expect(body).not.toContain("createMissingIngredients");
  });
});
