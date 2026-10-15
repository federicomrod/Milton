// Plato por plato (PR A): inline "Crear preparación", the one-click confirm
// that keeps the POS link and the recipe version as separate steps, the
// dish queue and the main button. Synthetic names and prices only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEditorAction } from "@/lib/restaurant/recipe-costing/editor-actions";
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
// Crear preparación
// ---------------------------------------------------------------------------

const ctx = (state: MemoryEditorState, componentId?: string) => ({
  store: createMemoryEditorStore(state),
  companyId: "co-1",
  odooProductId: 7,
  locationId: null,
  userId: "u1",
  componentId,
});

function draft(): MemoryEditorState {
  return memoryEditorState({
    ingredients: [{ id: "i-harina", name: "Harina", default_unit: "oz" }],
    entries: [entry("i-harina", "oz", 0.1)],
    components: [{ id: "c-old", name: "Salsa ejemplo uno", output_unit: "oz" }],
    version: {
      id: "v1",
      status: "in_review",
      kind: "dish",
      menu_item_id: "m1",
    },
    inputs: [],
    link: {
      id: "link-1",
      menu_item_id: "m1",
      evidence: {
        yield: { value: 1, unit: "porción", source: "confirmed" },
        lines: [
          {
            source_row: 9,
            raw_name: "SALSA DE LA CASA",
            ingredient_match: null,
            sub_recipe_match: null,
            qty: 2,
            unit: "oz",
            unit_cost: null,
            pending: true,
            flags: ["pendiente_ingrediente"],
            reasons: [],
          },
        ],
      },
    },
  });
}

describe("Crear preparación (inline, from the dish)", () => {
  it("parses the action from the request body", () => {
    expect(
      parseEditorAction({
        action: "create_preparation",
        name: "Salsa ejemplo dos",
        yield_quantity: 32,
        yield_unit: "oz",
        quantity: 2,
        line_unit: "oz",
      })
    ).toEqual({
      action: "create_preparation",
      name: "Salsa ejemplo dos",
      yield_quantity: 32,
      yield_unit: "oz",
      line_key: undefined,
      quantity: 2,
      line_unit: "oz",
    });
    expect(
      parseEditorAction({ action: "create_preparation", name: "X" })
    ).toBeNull();
  });

  it("creates a draft preparation and adds it to the recipe as a new line", async () => {
    const d = draft();
    const r = await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "Salsa ejemplo dos",
      yield_quantity: 32,
      yield_unit: "oz",
      quantity: 2,
      line_unit: "oz",
    });
    expect(r.ok).toBe(true);
    const prep = d.preparations.at(-1)!;
    expect(prep.name).toBe("Salsa ejemplo dos");
    // A draft: it counts nowhere until a person approves it.
    expect(prep.version).toMatchObject({
      status: "in_review",
      output_quantity: 32,
      output_unit: "oz",
    });
    expect(d.inputs.at(-1)).toMatchObject({
      input_type: "component",
      component_id: prep.component_id,
      quantity: 2,
      unit: "oz",
    });
    // No ingredient was created on the side.
    expect(d.ingredients).toHaveLength(1);
  });

  it("resolves an unresolved Excel line with the new preparation, keeping the Excel amount", async () => {
    const d = draft();
    const loaded = await loadEditor(ctx(d));
    if (!loaded.ok) throw new Error(loaded.error);
    const open = loaded.state.lines.find((l) => l.kind === "unresolved")!;
    const r = await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "Salsa de la casa",
      yield_quantity: 1,
      yield_unit: "lb",
      line_key: open.key,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const prep = d.preparations.at(-1)!;
    expect(d.inputs.at(-1)).toMatchObject({
      component_id: prep.component_id,
      quantity: 2,
      unit: "oz",
    });
    expect(r.state.lines.some((l) => l.kind === "unresolved")).toBe(false);
  });

  it("is reusable: the new preparation shows up in the picker for the next dish", async () => {
    const d = draft();
    await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "Salsa ejemplo dos",
      yield_quantity: 32,
      yield_unit: "oz",
      quantity: 1,
      line_unit: "oz",
    });
    const next = await loadEditor(ctx(d));
    if (!next.ok) throw new Error(next.error);
    expect(
      next.state.options.some(
        (o) => o.kind === "component" && o.name === "Salsa ejemplo dos"
      )
    ).toBe(true);
  });

  it("opens in Preparaciones with the yield the person typed, still a draft", async () => {
    const d = draft();
    await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "Salsa ejemplo dos",
      yield_quantity: 32,
      yield_unit: "oz",
      quantity: 1,
      line_unit: "oz",
    });
    const id = d.preparations.at(-1)!.component_id;
    const prep = await loadEditor(ctx(d, id));
    if (!prep.ok) throw new Error(prep.error);
    expect(prep.state.preparation).toMatchObject({
      status: "in_review",
      yield: { value: 32, unit: "oz", confirmed: true },
    });
    // No lines yet, so it cannot be approved.
    expect(prep.state.preparation?.checklist.ready).toBe(false);
  });

  it("refuses a duplicate name, a missing yield, and never creates anything then", async () => {
    const d = draft();
    const dup = await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "  salsa  EJEMPLO uno ",
      yield_quantity: 1,
      yield_unit: "oz",
      quantity: 1,
    });
    expect(dup).toMatchObject({ ok: false, status: 409 });
    const noYield = await applyEdit(ctx(d), {
      action: "create_preparation",
      name: "Salsa nueva",
      yield_quantity: 0,
      yield_unit: "oz",
      quantity: 1,
    });
    expect(noYield).toMatchObject({ ok: false, status: 400 });
    expect(d.preparations).toHaveLength(0);
    expect(d.inputs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// One click, two separate steps: POS link, then recipe version
// ---------------------------------------------------------------------------

const calls = vi.hoisted(() => ({
  link: null as Record<string, unknown> | null,
  confirmLink: [] as unknown[],
  approve: [] as unknown[],
  submit: [] as unknown[],
  approveResult: { ok: true } as { ok: true } | { ok: false; error: string },
}));

vi.mock("@/lib/restaurant/recipe-costing/link-actions-server", () => ({
  loadPosProductLink: async () => calls.link,
  confirmPosLinkForCompany: async (input: unknown) => {
    calls.confirmLink.push(input);
    return { ok: true, link: {} };
  },
}));

vi.mock("@/lib/restaurant/recipe-costing/approval-server", () => ({
  approveRecipeVersion: async (input: unknown) => {
    calls.approve.push(input);
    return calls.approveResult;
  },
  submitRecipeForApproval: async (input: unknown) => {
    calls.submit.push(input);
    return { ok: true };
  },
}));

import {
  PLATO_ROLE_ERROR,
  confirmPlato,
} from "@/lib/restaurant/recipe-costing/plato-server";

function versions(rows: Record<string, unknown>[]) {
  return {
    from() {
      const filters: Array<[string, unknown]> = [];
      const b = {
        select: () => b,
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return b;
        },
        maybeSingle: async () => ({
          data: rows.find((r) => filters.every(([k, v]) => r[k] === v)) ?? null,
          error: null,
        }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const draftVersion = {
  id: "v1",
  company_id: "co",
  menu_item_id: "m1",
  status: "in_review",
};
const actor = (role: string | null, staff = false) => ({
  user_id: "u",
  role,
  is_milton_staff: staff,
});
const base = (over: Partial<Parameters<typeof confirmPlato>[0]> = {}) => ({
  supabase: versions([draftVersion]),
  companyId: "co",
  actor: actor("owner"),
  odooProductId: 7,
  recipeVersionId: "v1",
  ...over,
});

describe("Aprobar y siguiente: POS link and recipe stay separate", () => {
  beforeEach(() => {
    calls.link = { menu_item_id: "m1", link_state: "sugerido" };
    calls.confirmLink = [];
    calls.approve = [];
    calls.submit = [];
    calls.approveResult = { ok: true };
  });

  it("owner: confirms the link, then approves the version (two calls)", async () => {
    const r = await confirmPlato(base());
    expect(r).toEqual({ ok: true, link: "confirmado", recipe: "aprobada" });
    expect(calls.confirmLink).toHaveLength(1);
    expect(calls.approve).toHaveLength(1);
    expect(calls.submit).toHaveLength(0);
  });

  it("an already confirmed link is not confirmed again", async () => {
    calls.link = { menu_item_id: "m1", link_state: "confirmado" };
    const r = await confirmPlato(base());
    expect(r).toMatchObject({ ok: true, link: "ya_confirmado" });
    expect(calls.confirmLink).toHaveLength(0);
    expect(calls.approve).toHaveLength(1);
  });

  it("manager: confirms the link and sends the recipe for approval, never approves", async () => {
    const r = await confirmPlato(base({ actor: actor("manager") }));
    expect(r).toEqual({ ok: true, link: "confirmado", recipe: "enviada" });
    expect(calls.approve).toHaveLength(0);
    expect(calls.submit).toHaveLength(1);
  });

  it("Milton staff without the client's confirmation: nothing is written", async () => {
    const r = await confirmPlato(base({ actor: actor(null, true) }));
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(calls.confirmLink).toHaveLength(0);
    expect(calls.approve).toHaveLength(0);
    const ok = await confirmPlato(
      base({ actor: actor(null, true), confirmedHow: "whatsapp" })
    );
    expect(ok).toMatchObject({ ok: true, recipe: "aprobada" });
    expect(calls.approve[0]).toMatchObject({ confirmedHow: "whatsapp" });
  });

  it("a viewer cannot do either step", async () => {
    const r = await confirmPlato(base({ actor: actor("viewer") }));
    expect(r).toEqual({ ok: false, error: PLATO_ROLE_ERROR, status: 403 });
    expect(calls.confirmLink).toHaveLength(0);
  });

  it("an approved recipe only gets its link confirmed (the recipe is untouched)", async () => {
    const r = await confirmPlato(
      base({ supabase: versions([{ ...draftVersion, status: "approved" }]) })
    );
    expect(r).toEqual({ ok: true, link: "confirmado", recipe: "ya_aprobada" });
    expect(calls.approve).toHaveLength(0);
  });

  it("if approval is refused, the link stays confirmed and the message says so", async () => {
    calls.approveResult = { ok: false, error: "Hay líneas pendientes." };
    const r = await confirmPlato(base());
    expect(r).toMatchObject({
      ok: false,
      link_confirmed: true,
    });
    expect(!r.ok && r.error).toMatch(
      /El vínculo con el POS sí quedó confirmado/
    );
  });

  it("refuses a version that belongs to another dish, before writing", async () => {
    const r = await confirmPlato(
      base({ supabase: versions([{ ...draftVersion, menu_item_id: "other" }]) })
    );
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect(calls.confirmLink).toHaveLength(0);
  });

  it("a dish with no recipe cannot be confirmed", async () => {
    calls.link = { menu_item_id: null, link_state: "sin_vincular" };
    const r = await confirmPlato(base());
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});
