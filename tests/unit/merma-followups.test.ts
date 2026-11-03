// Merma follow-ups (#407 / #477): the default 1 unit stays «assumed», the
// Preparaciones filter, roles, the proportional share via preparations (2
// levels deep) and «Falta conversión». Demo data only.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_QUANTITY,
  filterMissingYield,
  isMeasuredOutput,
} from "@/lib/restaurant/prep-yield";
import {
  impactOfUse,
  impactViaPreps,
  redactMermaInputs,
  sumImpacts,
  type PrepDef,
} from "@/lib/restaurant/merma-visibility";
import {
  applyEdit,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
  type MemoryEditorState,
} from "./helpers/memory-editor-store";

// ---------------------------------------------------------------------------
// 1 · the default 1 unit stays «assumed»
// ---------------------------------------------------------------------------

describe("the default 1-unit output", () => {
  it("is not measured until a real output is entered", () => {
    expect(DEFAULT_OUTPUT_QUANTITY).toBe(1);
    const base = { status: "in_review", evidence: null };
    expect(isMeasuredOutput({ ...base, quantity: 1 })).toBe(false);
    expect(isMeasuredOutput({ ...base, quantity: 6.5 })).toBe(true);
    expect(isMeasuredOutput({ ...base, quantity: null })).toBe(false);
  });
  it("an explicit reading wins; an approved version was confirmed", () => {
    expect(
      isMeasuredOutput({
        quantity: 1,
        status: "in_review",
        evidence: { confirmed: true },
      })
    ).toBe(true);
    expect(
      isMeasuredOutput({
        quantity: 6.5,
        status: "in_review",
        evidence: { confirmed: false },
      })
    ).toBe(false);
    expect(
      isMeasuredOutput({ quantity: 1, status: "approved", evidence: null })
    ).toBe(true);
  });

  function prepState(): MemoryEditorState {
    return memoryEditorState({
      ingredients: [
        { id: "i-tomate", name: "Tomate demo", default_unit: "oz" },
      ],
      entries: [entry("i-tomate", "oz", 0.04)],
      components: [{ id: "c-salsa", name: "Salsa demo", output_unit: "oz" }],
      preparations: [
        {
          component_id: "c-salsa",
          name: "Salsa demo",
          version: {
            id: "cv1",
            status: "in_review",
            kind: "preparation",
            component_id: "c-salsa",
            component_recipe_id: "cr1",
            output_quantity: 1,
            output_unit: "unit",
          },
          inputs: [
            {
              id: "pin-1",
              input_type: "ingredient",
              ingredient_id: "i-tomate",
              component_id: null,
              quantity: 16,
              unit: "oz",
            },
          ],
          // No open draft: only the version's default 1 is left.
          holder: { id: null, evidence: {} },
        },
      ],
    } as never);
  }
  const ctx = (s: MemoryEditorState) => ({
    store: createMemoryEditorStore(s),
    companyId: "co-1",
    odooProductId: 0,
    locationId: null,
    componentId: "c-salsa",
    userId: "u1",
  });

  it("a default 1 with no reading is assumed in the editor and blocks the checklist", async () => {
    const r = await loadEditor(ctx(prepState()));
    expect(r.ok && r.state.preparation!.yield).toMatchObject({
      value: 1,
      confirmed: false,
      source: "assumed",
    });
    expect(r.ok && r.state.preparation!.checklist.yield_confirmed).toBe(false);
  });
  it("saving a change without touching the output keeps it assumed; entering a batch measures it", async () => {
    const s = prepState();
    // A real edit of the recipe: add a line, leave the output alone.
    const added = await applyEdit(ctx(s), {
      action: "add",
      kind: "ingredient",
      id: "i-tomate",
      quantity: 2,
      unit: "oz",
    } as never);
    expect(added.ok).toBe(true);
    const still = await loadEditor(ctx(s));
    expect(still.ok && still.state.preparation!.yield!.confirmed).toBe(false);
    await applyEdit(ctx(s), { action: "set_yield", quantity: 6.5, unit: "kg" });
    const after = await loadEditor(ctx(s));
    expect(after.ok && after.state.preparation!.yield).toMatchObject({
      value: 6.5,
      confirmed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// 2 · the filter
// ---------------------------------------------------------------------------

describe("«Falta rendimiento» filter", () => {
  const rows = [
    { id: "a", yield_to_confirm: true },
    { id: "b", yield_to_confirm: false },
    { id: "c", yield_to_confirm: true },
  ];
  it("shows exactly the flagged preparations; off shows all", () => {
    expect(filterMissingYield(rows, true).map((r) => r.id)).toEqual(["a", "c"]);
    expect(filterMissingYield(rows, false)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 3 · roles
// ---------------------------------------------------------------------------

describe("cooks get no money", () => {
  const item = {
    price: 10,
    previous_price: 9,
    price_unit: "kg",
    price_date: "2026-10-01",
    yieldPct: 20,
    yieldHistory: [{}],
    sold_net_sales: 4200,
  };
  it("redacts price and merma inputs for a role without prices.view", () => {
    expect(redactMermaInputs(item, false)).toMatchObject({
      price: null,
      previous_price: null,
      price_unit: null,
      yieldPct: null,
      yieldHistory: [],
      sold_net_sales: 0,
    });
    expect(redactMermaInputs(item, true)).toEqual(item);
  });
});

// ---------------------------------------------------------------------------
// 4 · the proportional share via preparations
// ---------------------------------------------------------------------------

describe("«Impacto merma» through preparations", () => {
  const ctx = { price: 10, priceUnit: "kg", ownLossPct: null, bufferPct: 5 };
  // plato > prep A (output 5 kg) > prep B (output 4 kg) > Tomate (2 kg)
  const defs = (over: Partial<Record<string, Partial<PrepDef>>> = {}) =>
    new Map<string, PrepDef>([
      [
        "A",
        {
          id: "A",
          outputQty: 5,
          outputUnit: "kg",
          measured: false,
          lines: [{ kind: "component", componentId: "B", qty: 1, unit: "kg" }],
          ...over.A,
        },
      ],
      [
        "B",
        {
          id: "B",
          outputQty: 4,
          outputUnit: "kg",
          measured: false,
          lines: [
            { kind: "ingredient", ingredientId: "tomate", qty: 2, unit: "kg" },
          ],
          ...over.B,
        },
      ],
    ]);
  const via = [{ componentId: "A", qty: 2, unit: "kg" }];

  it("worked example, 2 levels deep: 2/5 × (1/4 × 5% of $20) = $0.10", () => {
    const d = defs();
    const r = impactViaPreps("tomate", via, d, ctx);
    expect(r.kind).toBe("extra");
    expect(r.kind === "extra" && r.amount).toBeCloseTo(0.1, 9);
  });
  it("a measured prep above means no factor: —", () => {
    const d = defs({ A: { measured: true } });
    expect(impactViaPreps("tomate", via, d, ctx)).toEqual({
      kind: "none",
    });
  });
  it("an own yield still applies once inside a measured prep (share of the extra)", () => {
    const d = defs({ A: { measured: true } });
    const r = impactViaPreps("tomate", via, d, { ...ctx, ownLossPct: 20 });
    // batch extra in B: 20/0.8 − 20 = 5 → ×1/4 in A → ×2/5 in the plato = 0.5
    expect(r.kind === "extra" && r.amount).toBeCloseTo(0.5, 9);
  });
  it("a share that cannot be computed is «unknown» (— vía preparación)", () => {
    const noOutput = defs({ A: { outputQty: null } });
    expect(impactViaPreps("tomate", via, noOutput, ctx).kind).toBe("unknown");
    const badUnit = [{ componentId: "A", qty: 2, unit: "unidad" }];
    const d = defs();
    expect(impactViaPreps("tomate", badUnit, d, ctx).kind).toBe("unknown");
    expect(impactViaPreps("tomate", [], d, ctx).kind).toBe("unknown");
  });
  it("is path-aware: a measured prep on ANOTHER path does not remove the factor here", () => {
    // plato uses A (unmeasured) and C (measured); both use the same B.
    const d = defs();
    d.set("C", {
      id: "C",
      outputQty: 5,
      outputUnit: "kg",
      measured: true,
      lines: [{ kind: "component", componentId: "B", qty: 1, unit: "kg" }],
    });
    const both = [
      { componentId: "A", qty: 2, unit: "kg" },
      { componentId: "C", qty: 2, unit: "kg" },
    ];
    const r = impactViaPreps("tomate", both, d, ctx);
    // only the A path carries the factor: the same $0.10 as A alone
    expect(r.kind === "extra" && r.amount).toBeCloseTo(0.1, 9);
    expect(impactViaPreps("tomate", [both[1]], d, ctx)).toEqual({
      kind: "none",
    });
  });
  it("a use row that is itself covered passes that down", () => {
    const d = defs();
    expect(impactViaPreps("tomate", via, d, ctx, true)).toEqual({
      kind: "none",
    });
  });
  it("no price: ⚑ Falta, never 0", () => {
    const d = defs();
    expect(impactViaPreps("tomate", via, d, { ...ctx, price: 0 })).toEqual({
      kind: "missing",
    });
  });
});

// ---------------------------------------------------------------------------
// 5 · Falta conversión
// ---------------------------------------------------------------------------

describe("«Falta conversión»", () => {
  const base = { price: 10, priceUnit: "kg", ownLossPct: null, bufferPct: 5 };
  const line = (unit: string | null) => ({
    qty: 3,
    unit,
    insideMeasuredPrep: false,
  });
  it("«unidad» against a per-kg price, or no unit, is flagged, not guessed", () => {
    expect(impactOfUse({ ...base, line: line("unidad") })).toEqual({
      kind: "noConversion",
    });
    expect(impactOfUse({ ...base, line: line(null) })).toEqual({
      kind: "noConversion",
    });
    expect(impactOfUse({ ...base, priceUnit: null, line: line("kg") })).toEqual(
      {
        kind: "noConversion",
      }
    );
  });
  it("those lines are left out of the total (and counted as excluded)", () => {
    const results = [
      impactOfUse({ ...base, line: line("kg") }), // 3 kg × $10 × 5% = 1.5
      impactOfUse({ ...base, line: line("unidad") }),
      impactOfUse({ ...base, price: null, line: line("kg") }),
    ];
    const t = sumImpacts(results);
    expect(t.total).toBeCloseTo(1.5, 9);
    expect(t.counted).toBe(1);
    expect(t.excluded).toBe(2);
  });
});
