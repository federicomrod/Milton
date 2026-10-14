// R1-12 (Speed): the SQL groups feed the same builder, the editor reads
// the catalog while it finds the dish, a denied role writes nothing, and
// the POS link is saved before a recipe is approved. Synthetic data only.

import { describe, expect, it, vi } from "vitest";
import {
  buildPosProductList,
  type PosSaleLineForProductList,
} from "@/lib/restaurant/pos-product-list";
import {
  groupsToSyntheticLines,
  type PosSalesGroup,
} from "@/lib/restaurant/pos-sales-groups";
import { fetchAllRows } from "@/lib/restaurant/paginated-read";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const CO = "co-1";

function raw(
  over: Partial<PosSaleLineForProductList> = {}
): PosSaleLineForProductList {
  return {
    company_id: CO,
    location_id: "loc-1",
    raw_item_name: "Plato uno",
    quantity: 1,
    gross_revenue: 10,
    net_revenue: null,
    is_tip: null,
    category: null,
    source_metadata: { product_id: 1 },
    external_line_id: null,
    combo_parent_odoo_product_id: null,
    ...over,
  };
}

describe("SQL groups become the same dish list as the raw lines", () => {
  const build = (sales: PosSaleLineForProductList[]) =>
    buildPosProductList({
      companyId: CO,
      sales,
      links: [],
      recipeVersions: [],
      locationId: null,
    });

  it("sums, renames (last name wins) and categories (first wins) like the line walk", () => {
    // ids are the walk order: a < b < c < d.
    const lines = [
      raw({
        raw_item_name: "Viejo",
        category: "Fuertes",
        quantity: 2,
        gross_revenue: 20,
      }), // a
      raw({
        raw_item_name: "Nuevo",
        category: "Cenas",
        quantity: 1,
        gross_revenue: 12.5,
      }), // b
      raw({
        raw_item_name: "Viejo",
        category: null,
        quantity: 3,
        gross_revenue: 30,
      }), // c
      raw({
        raw_item_name: "Nuevo",
        category: null,
        quantity: 1,
        gross_revenue: 12.5,
      }), // d
    ];
    const groups: PosSalesGroup[] = [
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Viejo",
        is_tip: null,
        category: "Fuertes",
        quantity: 2,
        gross_revenue: 20,
        line_count: 1,
        first_id: "a",
        last_id: "a",
      },
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Nuevo",
        is_tip: null,
        category: "Cenas",
        quantity: 1,
        gross_revenue: 12.5,
        line_count: 1,
        first_id: "b",
        last_id: "b",
      },
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Viejo",
        is_tip: null,
        category: null,
        quantity: 3,
        gross_revenue: 30,
        line_count: 1,
        first_id: "c",
        last_id: "c",
      },
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Nuevo",
        is_tip: null,
        category: null,
        quantity: 1,
        gross_revenue: 12.5,
        line_count: 1,
        first_id: "d",
        last_id: "d",
      },
    ];
    // Merge as the SQL does (group by name/category): Viejo+null merges
    // with itself only when the category matches, so these stay four.
    expect(build(groupsToSyntheticLines(CO, groups))).toEqual(build(lines));
  });

  it("one group spanning many ids keeps the last name and the first category", () => {
    // Walk: Viejo(Fuertes) id1, Nuevo(Cenas) id2, Viejo(Fuertes) id3.
    // Groups: Viejo/Fuertes first=1,last=3 (2 lines), Nuevo/Cenas id2.
    const lines = [
      raw({ raw_item_name: "Viejo", category: "Fuertes", gross_revenue: 5 }),
      raw({ raw_item_name: "Nuevo", category: "Cenas", gross_revenue: 7 }),
      raw({ raw_item_name: "Viejo", category: "Fuertes", gross_revenue: 5 }),
    ];
    const groups: PosSalesGroup[] = [
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Viejo",
        is_tip: null,
        category: "Fuertes",
        quantity: 2,
        gross_revenue: 10,
        line_count: 2,
        first_id: "1",
        last_id: "3",
      },
      {
        location_id: "loc-1",
        product_id: 1,
        parent_product_id: null,
        name: "Nuevo",
        is_tip: null,
        category: "Cenas",
        quantity: 1,
        gross_revenue: 7,
        line_count: 1,
        first_id: "2",
        last_id: "2",
      },
    ];
    const fromGroups = build(groupsToSyntheticLines(CO, groups));
    const fromLines = build(lines);
    expect(fromGroups).toEqual(fromLines);
    expect(fromGroups.products[0].odoo_name).toBe("Viejo");
    expect(fromGroups.products[0].category).toBe("Fuertes");
  });

  it("combo children roll up to the parent and tips stay out", () => {
    const lines = [
      raw({
        source_metadata: { product_id: 9 },
        raw_item_name: "Combo",
        gross_revenue: 0,
      }),
      raw({
        source_metadata: { product_id: 5 },
        raw_item_name: "Parte",
        gross_revenue: 8,
        combo_parent_odoo_product_id: 9,
      }),
      raw({
        source_metadata: { product_id: 7 },
        raw_item_name: "Propina 10%",
        gross_revenue: 3,
      }),
    ];
    const groups: PosSalesGroup[] = [
      {
        location_id: "loc-1",
        product_id: 9,
        parent_product_id: null,
        name: "Combo",
        is_tip: null,
        category: null,
        quantity: 1,
        gross_revenue: 0,
        line_count: 1,
        first_id: "1",
        last_id: "1",
      },
      {
        location_id: "loc-1",
        product_id: 5,
        parent_product_id: 9,
        name: "Parte",
        is_tip: null,
        category: null,
        quantity: 1,
        gross_revenue: 8,
        line_count: 1,
        first_id: "2",
        last_id: "2",
      },
      {
        location_id: "loc-1",
        product_id: 7,
        parent_product_id: null,
        name: "Propina 10%",
        is_tip: null,
        category: null,
        quantity: 1,
        gross_revenue: 3,
        line_count: 1,
        first_id: "3",
        last_id: "3",
      },
    ];
    const a = build(groupsToSyntheticLines(CO, groups));
    expect(a).toEqual(build(lines));
    expect(a.net_sales).toBe(8);
    expect(a.products.map((p) => p.odoo_product_id)).toEqual([9]);
  });
});

function draftState() {
  return memoryEditorState({
    ingredients: [{ id: "i-1", name: "Harina", default_unit: "oz" }],
    entries: [entry("i-1", "oz", 0.1)],
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [
      {
        id: "in-1",
        input_type: "ingredient",
        ingredient_id: "i-1",
        component_id: null,
        quantity: 2,
        unit: "oz",
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
  });
}

const ctxFor = (state: ReturnType<typeof draftState>) => ({
  store: createMemoryEditorStore(state),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});

describe("editor reads: catalog starts with the dish lookup", () => {
  it("asks for the catalog, aliases and questions before the version is found", async () => {
    const order: string[] = [];
    const state = draftState();
    const base = createMemoryEditorStore(state);
    const store = {
      ...base,
      loadCosting: (c: string) => (order.push("costing"), base.loadCosting(c)),
      loadAliases: (c: string) => (order.push("aliases"), base.loadAliases(c)),
      catalogQuestions: (c: string) => (
        order.push("questions"),
        base.catalogQuestions(c)
      ),
      loadLink: (...a: Parameters<typeof base.loadLink>) => (
        order.push("link"),
        base.loadLink(...a)
      ),
      latestVersion: (...a: Parameters<typeof base.latestVersion>) => (
        order.push("version"),
        base.latestVersion(...a)
      ),
    };
    const result = await loadEditor({
      store,
      companyId: "co-1",
      odooProductId: 7,
      locationId: null,
      userId: "u1",
    });
    expect(result.ok).toBe(true);
    expect(order.indexOf("costing")).toBeLessThan(order.indexOf("version"));
    expect(order.indexOf("aliases")).toBeLessThan(order.indexOf("version"));
    // Each is read once, not once per rebuild.
    expect(order.filter((x) => x === "costing")).toHaveLength(1);
    expect(order.filter((x) => x === "aliases")).toHaveLength(1);
    expect(order.filter((x) => x === "questions")).toHaveLength(1);
  });
});

describe("applyEdit waits for the role check before writing", () => {
  it("a denied role writes nothing and answers 403", async () => {
    const state = draftState();
    const write = vi.fn();
    const base = createMemoryEditorStore(state);
    const store = {
      ...base,
      updateInput: (...a: Parameters<typeof base.updateInput>) => (
        write(),
        base.updateInput(...a)
      ),
      saveEvidence: (...a: Parameters<typeof base.saveEvidence>) => (
        write(),
        base.saveEvidence(...a)
      ),
    };
    const result = await applyEdit(
      {
        ...ctxFor(state),
        store,
        guard: Promise.resolve({
          ok: false,
          error: "Tu rol no puede editar recetas.",
          status: 403,
        }),
      },
      { action: "update", input_id: "in-1", quantity: 5 }
    );
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(write).not.toHaveBeenCalled();
    expect(state.inputs[0].quantity).toBe(2);
  });

  it("an allowed role saves as before", async () => {
    const state = draftState();
    const result = await applyEdit(
      { ...ctxFor(state), guard: Promise.resolve(null) },
      { action: "update", input_id: "in-1", quantity: 5 }
    );
    expect(result.ok).toBe(true);
    expect(state.inputs[0].quantity).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Paged reads: a remembered size asks for every page at once
// ---------------------------------------------------------------------------

function pagedTable(total: number) {
  const started: number[] = [];
  const makeQuery = () => ({
    order: () => ({
      range: async (from: number, to: number) => {
        started.push(from);
        // PostgREST answers an out-of-range page with an empty array.
        const data = Array.from(
          { length: Math.max(0, Math.min(to + 1, total) - from) },
          (_, i) => ({ id: from + i })
        );
        return { data, error: null };
      },
    }),
  });
  return { makeQuery, started, setTotal: (n: number) => (total = n) };
}

describe("fetchAllRows with a remembered size", () => {
  it("first walk: page one, then the usual wave; the next walk: all pages at once, same rows", async () => {
    const table = pagedTable(1359);
    const first = await fetchAllRows<{ id: number }>(table.makeQuery, {
      hintKey: "t1",
    });
    expect(first.rows).toHaveLength(1359);
    expect(first.pages).toBe(9); // 1 + a wave of 8 (7 of them empty)
    table.started.length = 0;
    const second = await fetchAllRows<{ id: number }>(table.makeQuery, {
      hintKey: "t1",
    });
    expect(second.rows).toEqual(first.rows);
    expect(second.pages).toBe(2);
    expect(table.started.sort((a, b) => a - b)).toEqual([0, 1000]);
  });

  it("a table that grew past the remembered pages is still read completely", async () => {
    const table = pagedTable(1200);
    await fetchAllRows(table.makeQuery, { hintKey: "t2" });
    table.setTotal(3500);
    const grown = await fetchAllRows<{ id: number }>(table.makeQuery, {
      hintKey: "t2",
    });
    expect(grown.rows).toHaveLength(3500);
    expect(new Set(grown.rows.map((r) => r.id)).size).toBe(3500);
  });

  it("a table that shrank drops the empty pages", async () => {
    const table = pagedTable(4200);
    await fetchAllRows(table.makeQuery, { hintKey: "t3" });
    table.setTotal(900);
    const shrunk = await fetchAllRows<{ id: number }>(table.makeQuery, {
      hintKey: "t3",
    });
    expect(shrunk.rows).toHaveLength(900);
  });

  it("without a hint key nothing changes", async () => {
    const table = pagedTable(2500);
    const a = await fetchAllRows<{ id: number }>(table.makeQuery);
    const b = await fetchAllRows<{ id: number }>(table.makeQuery);
    expect(a.rows).toHaveLength(2500);
    expect(b.pages).toBe(a.pages);
  });
});

describe("the editor read (used by the read-ahead) never writes", () => {
  it("loadEditor touches no write method of the store", async () => {
    const state = draftState();
    const base = createMemoryEditorStore(state);
    const writes: string[] = [];
    const store = new Proxy(base, {
      get(target, prop: string) {
        const value = (target as unknown as Record<string, unknown>)[prop];
        if (
          typeof value === "function" &&
          /^(insert|update|delete|save|set|add|approve|resolve|create|remember|answer|skip)/.test(
            prop
          )
        ) {
          return (...args: unknown[]) => {
            writes.push(prop);
            return (value as (...a: unknown[]) => unknown)(...args);
          };
        }
        return value;
      },
    });
    const result = await loadEditor({
      store,
      companyId: "co-1",
      odooProductId: 7,
      locationId: null,
      userId: "u1",
    });
    expect(result.ok).toBe(true);
    expect(writes).toEqual([]);
    expect(state.inputs[0].quantity).toBe(2);
  });
});
