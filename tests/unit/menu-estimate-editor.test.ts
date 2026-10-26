// «Estimado por Milton» in the Validar editor: the mark on a line, its
// removal when a person edits the line, and the «Precio estimado» hint that
// is never a price. Synthetic names and prices only.

import { describe, expect, it } from "vitest";
import { liveApproval } from "@/lib/restaurant/recipe-costing/approval-live";
import { FLAG_MILTON_ESTIMATE } from "@/lib/restaurant/recipe-costing/editor";
import {
  applyEdit,
  loadEditor,
  type Ctx,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { applyEstimateToEvidence } from "@/lib/restaurant/menu-reading/estimate-server";
import {
  menuDraftEvidence,
  menuDraftLines,
} from "@/lib/restaurant/menu-reading/drafts";
import type { EstimatedLine } from "@/lib/restaurant/menu-reading/estimate";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
  type MemoryEditorState,
} from "./helpers/memory-editor-store";

const estLine = (over: Partial<EstimatedLine>): EstimatedLine => ({
  raw_name: "pollo",
  ingredient_id: null,
  qty: 200,
  unit: "g",
  price_source: "estimado",
  unit_price: 0.01,
  price_unit: "g",
  price_estimate_id: null,
  line_cost: 2,
  confidence: "alta",
  ...over,
});

/** A menu draft after «Usar como borrador»: quantities filled, still in review. */
function drafted(
  status: "in_review" | "approved" = "in_review",
  patch: Partial<MemoryEditorState> = {}
): MemoryEditorState {
  const lines = menuDraftLines(["pollo", "salsa"], {
    ingredients: [
      { id: "i-pollo", name: "Pollo", default_unit: "g" },
      { id: "i-salsa", name: "Salsa", default_unit: "oz" },
    ],
    preparations: [],
  });
  const base = menuDraftEvidence({
    match: {
      dish: {
        name: "Plato 1",
        section: null,
        price: 9,
        description: null,
        variants: [],
        components: ["pollo", "salsa"],
      },
      variant: null,
      basis: "name",
    } as never,
    lines,
    menuSourceId: null,
    menuUrl: null,
  });
  const { evidence } = applyEstimateToEvidence(base, [
    estLine({ raw_name: "pollo" }),
    estLine({ raw_name: "salsa", qty: 2, unit: "unidad" }),
  ]);
  return memoryEditorState({
    ingredients: [
      { id: "i-pollo", name: "Pollo", default_unit: "g" },
      { id: "i-salsa", name: "Salsa", default_unit: "unidad" },
    ],
    entries: [entry("i-pollo", "g", 0.005)],
    version: { id: "v1", status, kind: "dish", menu_item_id: "m1" },
    link: { id: "link-1", menu_item_id: "m1", evidence },
    ...patch,
  });
}

const ctx = (state: MemoryEditorState, extra: Partial<Ctx> = {}): Ctx => ({
  store: createMemoryEditorStore(state),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
  ...extra,
});

async function view(state: MemoryEditorState, extra: Partial<Ctx> = {}) {
  const r = await loadEditor(ctx(state, extra));
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

async function edit(
  state: MemoryEditorState,
  action: Parameters<typeof applyEdit>[1]
) {
  const r = await applyEdit(ctx(state), action);
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

describe("the «Estimado por Milton» mark", () => {
  it("shows on the filled lines, with the estimated quantity and unit", async () => {
    const s = await view(drafted());
    const pollo = s.lines.find((l) => l.raw_name === "pollo")!;
    expect(pollo).toMatchObject({ kind: "unresolved", qty: 200, unit: "g" });
    expect(pollo.flags).toContain(FLAG_MILTON_ESTIMATE);
    expect(pollo.flags).toContain("pendiente_ingrediente");
    expect(pollo.flags).not.toContain("pendiente_cantidad");
  });

  it("stays when a person only picks the ingredient (the quantity is still Milton's)", async () => {
    const st = drafted();
    const s = await edit(st, {
      action: "resolve",
      line_key: "u:0",
      kind: "ingredient",
      id: "i-pollo",
    });
    const pollo = s.lines.find((l) => l.name === "Pollo")!;
    expect(pollo).toMatchObject({ qty: 200, unit: "g" });
    expect(pollo.flags).toContain(FLAG_MILTON_ESTIMATE);
    // Saved with the evidence, so it survives a reload.
    const again = await view(st);
    expect(again.lines.find((l) => l.name === "Pollo")!.flags).toContain(
      FLAG_MILTON_ESTIMATE
    );
  });

  it("goes when the person types the quantity while picking", async () => {
    const s = await edit(drafted(), {
      action: "resolve",
      line_key: "u:0",
      kind: "ingredient",
      id: "i-pollo",
      quantity: 180,
      line_unit: "g",
    });
    const pollo = s.lines.find((l) => l.name === "Pollo")!;
    expect(pollo.qty).toBe(180);
    expect(pollo.flags).not.toContain(FLAG_MILTON_ESTIMATE);
  });

  it("goes when a person edits that line, and the other lines keep it", async () => {
    const st = drafted();
    await edit(st, {
      action: "resolve",
      line_key: "u:0",
      kind: "ingredient",
      id: "i-pollo",
    });
    await edit(st, {
      action: "resolve",
      line_key: "u:0", // salsa is now the first unresolved line
      kind: "ingredient",
      id: "i-salsa",
    });
    const before = await view(st);
    const input = before.lines.find((l) => l.name === "Pollo")!.input_id!;
    const s = await edit(st, {
      action: "update",
      input_id: input,
      quantity: 150,
    });
    expect(s.lines.find((l) => l.name === "Pollo")!.flags).not.toContain(
      FLAG_MILTON_ESTIMATE
    );
    expect(s.lines.find((l) => l.name === "Salsa")!.flags).toContain(
      FLAG_MILTON_ESTIMATE
    );
    // And it stays gone after a reload.
    const again = await view(st);
    expect(again.lines.find((l) => l.name === "Pollo")!.flags).not.toContain(
      FLAG_MILTON_ESTIMATE
    );
  });

  it("is not shown on an approved version", async () => {
    const st = drafted("approved");
    const s = await view(st);
    expect(s.editable).toBe(false);
    for (const l of s.lines)
      expect(l.flags).not.toContain(FLAG_MILTON_ESTIMATE);
  });
});

describe("«Precio estimado» is a hint, never a price", () => {
  const rows = [
    {
      ingredient_id: null,
      name_key: "salsa",
      unit: "unidad",
      unit_price: 0.5,
    },
    {
      // A real price exists for pollo: its row must never be shown.
      ingredient_id: "i-pollo",
      name_key: "pollo",
      unit: "g",
      unit_price: 0.02,
    },
  ];

  it("attaches to an unresolved line with no price, by name", async () => {
    const s = await view(drafted(), { priceEstimates: async () => rows });
    const salsa = s.lines.find((l) => l.raw_name === "salsa")!;
    expect(salsa.milton_price_estimate).toEqual({
      unit_price: 0.5,
      unit: "unidad",
    });
    expect(salsa.amount).toBeNull();
    expect(salsa.unit_cost).toBeNull();
  });

  it("attaches to a resolved ingredient with no real price; the line stays unpriced and blocks approval", async () => {
    const st = drafted();
    for (let i = 0; i < 2; i++) {
      await edit(st, {
        action: "resolve",
        line_key: "u:0",
        kind: "ingredient",
        id: i === 0 ? "i-pollo" : "i-salsa",
        quantity: i === 0 ? 200 : 2,
        line_unit: i === 0 ? "g" : "unidad",
      });
    }
    const s = await view(st, { priceEstimates: async () => rows });
    const salsa = s.lines.find((l) => l.name === "Salsa")!;
    expect(salsa.milton_price_estimate).toEqual({
      unit_price: 0.5,
      unit: "unidad",
    });
    // Still counts as missing a price.
    expect(salsa.price).toBeNull();
    expect(salsa.amount).toBeNull();
    expect(salsa.pending).toBe(true);
    expect(s.total_cost).toBeNull();
    // The line with a real price shows the real price and no hint.
    const pollo = s.lines.find((l) => l.name === "Pollo")!;
    expect(pollo.milton_price_estimate).toBeUndefined();
    expect(pollo.amount).toBeCloseTo(1, 10);
    // Approval stays blocked by the missing price.
    const approval = liveApproval({ lines: s.lines });
    expect(approval.ready).toBe(false);
    expect(approval.blockers.map((b) => b.kind)).toContain("price");
  });

  it("the same view without the hint is identical in cost and approval", async () => {
    const st = drafted();
    for (let i = 0; i < 2; i++) {
      await edit(st, {
        action: "resolve",
        line_key: "u:0",
        kind: "ingredient",
        id: i === 0 ? "i-pollo" : "i-salsa",
        quantity: i === 0 ? 200 : 2,
        line_unit: i === 0 ? "g" : "unidad",
      });
    }
    const plain = await view(st);
    const hinted = await view(st, { priceEstimates: async () => rows });
    expect(
      hinted.lines.map(({ milton_price_estimate, ...rest }) => {
        void milton_price_estimate;
        return rest;
      })
    ).toEqual(plain.lines);
    expect(hinted.total_cost).toBe(plain.total_cost);
    expect(hinted.pending).toBe(plain.pending);
    expect(liveApproval({ lines: hinted.lines })).toEqual(
      liveApproval({ lines: plain.lines })
    );
  });

  it("a failing or missing estimate table changes nothing", async () => {
    const plain = await view(drafted());
    const failing = await view(drafted(), {
      priceEstimates: async () => {
        throw new Error("relation does not exist");
      },
    });
    expect(failing).toEqual(plain);
    expect(
      plain.lines.every((l) => l.milton_price_estimate === undefined)
    ).toBe(true);
  });
});

describe("applyEstimateToEvidence", () => {
  it("keeps the unresolved flags and creates nothing", () => {
    const lines = menuDraftLines(["pollo"], {
      ingredients: [],
      preparations: [],
    });
    const before = JSON.stringify(lines);
    const { evidence, applied } = applyEstimateToEvidence(
      { source: "menu", status: "borrador", lines },
      [estLine({ raw_name: "pollo" })]
    );
    expect(applied).toBe(1);
    // The input evidence is not mutated.
    expect(JSON.stringify(lines)).toBe(before);
    const line = (evidence.lines as Array<Record<string, unknown>>)[0];
    expect(line.flags).toEqual([
      "pendiente_ingrediente",
      "del_menu",
      "nuevo_sugerido",
      FLAG_MILTON_ESTIMATE,
    ]);
    expect(line.unit_cost).toBeNull();
    expect(evidence.status).toBe("borrador");
  });

  it("appends each missing estimate line on an empty draft", () => {
    const { evidence, applied, not_copied } = applyEstimateToEvidence(
      { source: "menu", status: "borrador", lines: [] },
      [
        estLine({
          raw_name: "entraña",
          qty: 8,
          unit: "oz",
          ingredient_id: "i-1",
        }),
        estLine({ raw_name: "chimichurri", qty: 30, unit: "g" }),
      ]
    );
    expect(applied).toBe(2);
    expect(not_copied).toEqual([]);
    const lines = evidence.lines as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      raw_name: "entraña",
      qty: 8,
      unit: "oz",
      unit_cost: null,
      ingredient_match: "entraña",
      pending: true,
    });
    expect(lines[0].flags).toEqual([
      "pendiente_ingrediente",
      FLAG_MILTON_ESTIMATE,
    ]);
    expect(lines[1]).toMatchObject({
      raw_name: "chimichurri",
      qty: 30,
      unit: "g",
      unit_cost: null,
      ingredient_match: null,
    });
    expect(lines[1].flags).toEqual([
      "pendiente_ingrediente",
      FLAG_MILTON_ESTIMATE,
      "nuevo_sugerido",
    ]);
    expect(evidence.status).toBe("borrador");
  });

  it("fills existing lines and does not duplicate by normalized name", () => {
    const lines = menuDraftLines(["Pollo", "salsa"], {
      ingredients: [],
      preparations: [],
    });
    const { evidence, applied, not_copied } = applyEstimateToEvidence(
      { source: "menu", status: "borrador", lines },
      [
        estLine({ raw_name: "pollo" }),
        estLine({ raw_name: "POLLO", qty: 99, unit: "oz" }),
        estLine({ raw_name: "cebolla", qty: 20, unit: "g" }),
      ]
    );
    expect(applied).toBe(2);
    expect(not_copied).toEqual([]);
    const next = evidence.lines as Array<Record<string, unknown>>;
    expect(next.map((l) => l.raw_name)).toEqual(["Pollo", "salsa", "cebolla"]);
    expect(next[0]).toMatchObject({ qty: 200, unit: "g" });
    expect(next[0].flags).toContain(FLAG_MILTON_ESTIMATE);
    expect(next[1]).toMatchObject({ qty: null, unit: null });
    expect(next[1].flags).not.toContain(FLAG_MILTON_ESTIMATE);
    expect(next[2]).toMatchObject({
      raw_name: "cebolla",
      qty: 20,
      unit: "g",
      unit_cost: null,
    });
    expect(next[2].flags).toContain(FLAG_MILTON_ESTIMATE);
  });
});
