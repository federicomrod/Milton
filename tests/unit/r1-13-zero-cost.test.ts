// R1-13: a price of $0 typed on purpose (water, ice) is a confirmed price;
// a missing price is "Sin precio" and is never turned into $0. Synthetic data.

import { describe, expect, it } from "vitest";
import {
  getLatestIngredientCost,
  type CostingData,
} from "@/lib/restaurant/costing";
import { lineCostDisplay } from "@/lib/restaurant/recipe-costing/format";
import {
  optimisticAddLine,
  optimisticLine,
} from "@/lib/restaurant/recipe-costing/editor";
import { buildApprovalChecklist } from "@/lib/restaurant/recipe-costing/approval";
import { parseSuggestionEvidence } from "@/lib/restaurant/recipe-costing/evidence";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

function costingWith(entries: ReturnType<typeof entry>[]): CostingData {
  return {
    ingredientsById: new Map([
      ["i-agua", { id: "i-agua", name: "Agua", default_unit: "l" }],
    ]),
    costEntriesByIngredientId: new Map([["i-agua", entries]]),
  } as unknown as CostingData;
}

describe("engine: confirmed $0 vs missing", () => {
  it("a manual $0 entry is a price of 0", () => {
    const r = getLatestIngredientCost(
      "i-agua",
      costingWith([entry("i-agua", "l", 0, { source_type: "manual" })])
    );
    expect(r.status).toBe("complete");
    expect(r.unit_cost).toBe(0);
  });

  it("a $0 that came from a file or invoice is NOT a price: stays missing", () => {
    for (const source_type of ["import", "invoice_line", "api"] as const) {
      const r = getLatestIngredientCost(
        "i-agua",
        costingWith([entry("i-agua", "l", 0, { source_type })])
      );
      expect(r.status).toBe("no_cost_entries");
      expect(r.unit_cost).toBeNull();
    }
  });

  it("no entry at all is missing, not 0", () => {
    const r = getLatestIngredientCost("i-agua", costingWith([]));
    expect(r.status).toBe("no_cost_entries");
    expect(r.unit_cost).toBeNull();
  });

  it("a real price from a file still wins over an older imported $0", () => {
    const r = getLatestIngredientCost(
      "i-agua",
      costingWith([
        entry("i-agua", "l", 0, {
          source_type: "import",
          cost_date: "2026-05-01",
          effective_date: "2026-05-01",
        }),
        entry("i-agua", "l", 0.4, {
          source_type: "import",
          cost_date: "2026-04-01",
          effective_date: "2026-04-01",
        }),
      ])
    );
    expect(r.unit_cost).toBe(0.4);
  });
});

describe("screen helpers", () => {
  it("a $0 line price is shown as a price; missing stays Pendiente", () => {
    expect(lineCostDisplay({ unit_cost: 0 }).amount).toBe(0);
    expect(lineCostDisplay({ unit_cost: null }).label).toBe("Pendiente");
    expect(lineCostDisplay({ unit_cost: 0, pending: true }).label).toBe(
      "Pendiente"
    );
  });

  it("optimistic edits cost a line at $0 only for a typed 0", () => {
    const base = {
      total_cost: null,
      lines: [
        {
          input_id: "a",
          qty: 2,
          unit_cost: null,
          amount: null,
          pending: true,
          own_cost: false,
        },
      ],
    } as never;
    const zero = optimisticLine(base, "a", { unit_cost: 0 }) as {
      lines: Array<{ amount: number | null }>;
    };
    expect(zero.lines[0].amount).toBe(0);
    // No price given: the amount stays unknown.
    const none = optimisticLine(base, "a", { qty: 3 }) as {
      lines: Array<{ amount: number | null }>;
    };
    expect(none.lines[0].amount).toBeNull();
    const added = optimisticAddLine(
      { lines: [], total_cost: null } as never,
      {
        kind: "ingredient",
        id: "x",
        name: "Hielo",
        unit: "kg",
        unit_cost: 0,
        price_date: null,
        price_source: null,
      },
      2,
      "kg"
    ) as { lines: Array<{ amount: number | null }> };
    expect(added.lines[0].amount).toBe(0);
    const missing = optimisticAddLine(
      { lines: [], total_cost: null } as never,
      {
        kind: "ingredient",
        id: "x",
        name: "Hielo",
        unit: "kg",
        unit_cost: null,
        price_date: null,
        price_source: null,
      },
      2,
      "kg"
    ) as { lines: Array<{ amount: number | null }> };
    expect(missing.lines[0].amount).toBeNull();
  });

  it("a recipe whose lines are all priced at $0 has a computed cost of 0", () => {
    const evidence = parseSuggestionEvidence({
      yield: { value: 1, unit: "porción", source: "confirmed" },
      milton_cost: 0,
      lines: [
        {
          raw_name: "AGUA",
          ingredient_match: "Agua",
          qty: 1,
          unit: "l",
          pending: false,
          flags: [],
          reasons: [],
          unit_cost: 0,
        },
      ],
    });
    const ck = buildApprovalChecklist({
      link_state: "confirmado",
      evidence,
      yield_confirmed: true,
    });
    expect(ck.blockers).not.toContain("La receta no tiene un costo calculado.");
    // A recipe with a missing cost still blocks.
    const missing = parseSuggestionEvidence({
      yield: { value: 1, unit: "porción", source: "confirmed" },
      milton_cost: null,
      lines: [
        {
          raw_name: "AGUA",
          qty: 1,
          unit: "l",
          pending: true,
          flags: ["pendiente_costo"],
          reasons: [],
        },
      ],
    });
    const bad = buildApprovalChecklist({
      link_state: "confirmado",
      evidence: missing,
      yield_confirmed: true,
    });
    expect(bad.blockers).toContain("La receta no tiene un costo calculado.");
  });
});

function recipe(withPrice: boolean) {
  return memoryEditorState({
    ingredients: [{ id: "i-agua", name: "Agua", default_unit: "l" }],
    entries: withPrice
      ? [entry("i-agua", "l", 0, { source_type: "manual" })]
      : [],
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
        ingredient_id: "i-agua",
        component_id: null,
        quantity: 2,
        unit: "l",
        unit_cost: null,
        cost_source: null,
      },
    ],
    link: { id: "link-1", menu_item_id: "m1", evidence: {} },
  });
}
const ctxOf = (state: ReturnType<typeof recipe>) => ({
  store: createMemoryEditorStore(state),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
});

describe("recipe editor with $0", () => {
  it("a line of a confirmed-$0 ingredient is costed at 0, not pending", async () => {
    const r = await loadEditor(ctxOf(recipe(true)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const line = r.state.lines[0];
    expect(line.amount).toBe(0);
    expect(line.pending).toBe(false);
    expect(r.state.total_cost).toBe(0);
  });

  it("the same ingredient with no price stays pending: Sin precio, never $0", async () => {
    const r = await loadEditor(ctxOf(recipe(false)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.lines[0].amount).toBeNull();
    expect(r.state.lines[0].pending).toBe(true);
    expect(r.state.total_cost).toBeNull();
  });

  it("set_price 0 saves a manual $0 entry with a note, and the line then costs 0", async () => {
    const s = recipe(false);
    const r = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-agua",
      unit: "l",
      unit_cost: 0,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({
      source_type: "manual",
      unit_cost: 0,
      notes: "Precio $0 confirmado a propósito",
    });
    expect(r.state.lines[0].amount).toBe(0);
    expect(r.state.total_cost).toBe(0);
  });

  it("set_line_cost 0 on an ingredient line is a confirmed $0 for that ingredient", async () => {
    const s = recipe(false);
    const r = await applyEdit(ctxOf(s), {
      action: "set_line_cost",
      input_id: "in-1",
      unit_cost: 0,
    });
    expect(r.ok).toBe(true);
    expect(s.entries[0]).toMatchObject({ source_type: "manual", unit_cost: 0 });
  });

  it("creating an ingredient with price 0 stores it; with no price stores nothing", async () => {
    const withZero = recipe(false);
    const a = await applyEdit(ctxOf(withZero), {
      action: "create_ingredient",
      name: "Hielo",
      unit: "kg",
      unit_cost: 0,
    });
    expect(a.ok).toBe(true);
    expect(
      withZero.entries.some(
        (e) => e.unit_cost === 0 && e.source_type === "manual"
      )
    ).toBe(true);
    const without = recipe(false);
    const b = await applyEdit(ctxOf(without), {
      action: "create_ingredient",
      name: "Hielo",
      unit: "kg",
    });
    expect(b.ok).toBe(true);
    expect(without.entries).toHaveLength(0);
  });

  it("a negative or missing price is refused, never saved as 0", async () => {
    const s = recipe(false);
    for (const unit_cost of [-1, Number.NaN]) {
      const r = await applyEdit(ctxOf(s), {
        action: "set_price",
        ingredient_id: "i-agua",
        unit: "l",
        unit_cost,
      });
      expect(r.ok).toBe(false);
    }
    const r2 = await applyEdit(ctxOf(s), {
      action: "set_price",
      ingredient_id: "i-agua",
      unit: "l",
      unit_cost: undefined as unknown as number,
    });
    expect(r2.ok).toBe(false);
    expect(s.entries).toHaveLength(0);
  });
});
