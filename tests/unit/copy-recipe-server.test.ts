// «Copiar receta de…»: a new in-review draft, never a change to the source or
// to an approved version; a draft with lines is only touched after an answer;
// everything is scoped by company. Synthetic data only.

import { describe, expect, it, vi } from "vitest";
import {
  copyRecipeLinesForCompany,
  listCopyCandidates,
  loadCopySource,
  pickCopyVersion,
  type CopySource,
} from "@/lib/restaurant/recipe-costing/copy-recipe-server";
import {
  createMemoryEditorStore,
  memoryEditorState,
  type MemoryEditorState,
} from "./helpers/memory-editor-store";

const SOURCE: CopySource = {
  menu_item_id: "m-src",
  name: "Parrillada Demo 6 oz",
  version_status: "approved",
  inputs: [
    {
      id: "s1",
      input_type: "ingredient",
      ingredient_id: "i-res",
      component_id: null,
      quantity: 6,
      unit: "oz",
    },
    {
      id: "s2",
      input_type: "component",
      ingredient_id: null,
      component_id: "c-chimi",
      quantity: 2,
      unit: "oz",
      unit_cost: 0.5,
      cost_source: "ARCHIVO!B3",
    },
  ],
  yield: { value: 1, unit: "porción", source: "confirmed" },
};

function targetState(over: Partial<MemoryEditorState> = {}) {
  return memoryEditorState({
    link: { id: "l1", menu_item_id: "m-tgt", evidence: {} },
    version: {
      id: "v-appr",
      status: "approved",
      kind: "dish",
      menu_item_id: "m-tgt",
      version_number: 1,
    },
    inputs: [
      {
        id: "t1",
        input_type: "ingredient",
        ingredient_id: "i-pollo",
        quantity: 5,
        unit: "oz",
        component_id: null,
      },
    ],
    ...over,
  });
}

function run(
  state: MemoryEditorState,
  over: Partial<Parameters<typeof copyRecipeLinesForCompany>[0]> = {}
) {
  return copyRecipeLinesForCompany({
    store: createMemoryEditorStore(state),
    loadSource: async (id) => (id === SOURCE.menu_item_id ? SOURCE : null),
    createRecipe: async () => ({ ok: true }),
    isRecipeShared: async () => false,
    companyId: "co-1",
    odooProductId: 7,
    sourceMenuItemId: "m-src",
    ...over,
  });
}

describe("copyRecipeLinesForCompany", () => {
  it("into an approved recipe: a NEW in-review draft; the approved version is untouched", async () => {
    const state = targetState();
    const res = await run(state);
    expect(res).toMatchObject({
      ok: true,
      lines_copied: 2,
      created_draft: true,
      created_recipe: false,
    });
    expect(state.version?.status).toBe("in_review");
    expect(state.version?.id).not.toBe("v-appr");
    expect(state.inputs.map((i) => [i.ingredient_id, i.component_id])).toEqual([
      ["i-res", null],
      [null, "c-chimi"],
    ]);
    // Quantities, units and the file cost travel with the line.
    expect(state.inputs[1]).toMatchObject({
      quantity: 2,
      unit: "oz",
      unit_cost: 0.5,
      cost_source: "ARCHIVO!B3",
    });
    const older = state.olderVersions?.[0];
    expect(older?.version).toMatchObject({ id: "v-appr", status: "approved" });
    expect(older?.inputs.map((i) => i.id)).toEqual(["t1"]);
  });

  it("never changes the source recipe", async () => {
    const before = JSON.stringify(SOURCE);
    await run(targetState());
    expect(JSON.stringify(SOURCE)).toBe(before);
  });

  it("a draft with lines is not touched until the person answers", async () => {
    const state = targetState({
      version: {
        id: "v-draft",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-tgt",
        version_number: 2,
      },
    });
    const res = await run(state);
    expect(res).toMatchObject({
      ok: false,
      status: 409,
      needs_mode: true,
      draft_line_count: 1,
    });
    expect(state.inputs.map((i) => i.id)).toEqual(["t1"]);
  });

  it("replace swaps the draft's lines for the copied ones", async () => {
    const state = targetState({
      version: {
        id: "v-draft",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-tgt",
        version_number: 2,
      },
    });
    const res = await run(state, { mode: "replace" });
    expect(res).toMatchObject({
      ok: true,
      lines_copied: 2,
      created_draft: false,
    });
    expect(state.version?.id).toBe("v-draft");
    expect(state.inputs).toHaveLength(2);
    expect(state.inputs.some((i) => i.id === "t1")).toBe(false);
  });

  it("append keeps the draft's lines and adds the copied ones after them", async () => {
    const state = targetState({
      version: {
        id: "v-draft",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-tgt",
        version_number: 2,
      },
    });
    const res = await run(state, { mode: "append" });
    expect(res.ok).toBe(true);
    expect(state.inputs).toHaveLength(3);
    expect(state.inputs[0].id).toBe("t1");
  });

  it("an empty draft takes the lines with no question", async () => {
    const state = targetState({
      version: {
        id: "v-empty",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-tgt",
        version_number: 1,
      },
      inputs: [],
    });
    const res = await run(state);
    expect(res).toMatchObject({ ok: true, created_draft: false });
    expect(state.inputs).toHaveLength(2);
  });

  it("a product with no recipe or link gets one first (and only if the source is valid)", async () => {
    const state = targetState({ link: null, version: null, inputs: [] });
    const createRecipe = vi.fn(async () => {
      state.link = { id: "l-new", menu_item_id: "m-new", evidence: {} };
      state.version = {
        id: "v-new",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-new",
        version_number: 1,
      };
      return { ok: true as const };
    });
    const bad = await run(state, { createRecipe, sourceMenuItemId: "nope" });
    expect(bad).toMatchObject({ ok: false, status: 404 });
    expect(createRecipe).not.toHaveBeenCalled();

    const res = await run(state, { createRecipe });
    expect(res).toMatchObject({ ok: true, created_recipe: true });
    expect(createRecipe).toHaveBeenCalledTimes(1);
    expect(state.inputs).toHaveLength(2);
    expect(state.version?.status).toBe("in_review");
  });

  it("refuses to copy a recipe onto itself", async () => {
    const res = await run(targetState(), {
      sourceMenuItemId: "m-src",
      loadSource: async () => ({ ...SOURCE, menu_item_id: "m-tgt" }),
    });
    expect(res).toMatchObject({ ok: false, status: 400 });
  });

  it("copies the source yield only when this product has none of its own", async () => {
    const empty = targetState();
    await run(empty);
    expect(empty.link?.evidence.yield).toMatchObject({
      value: 1,
      source: "assumed",
      confirmed: false,
    });
    const own = targetState({
      link: {
        id: "l1",
        menu_item_id: "m-tgt",
        evidence: { yield: { value: 4, source: "confirmed" } },
      },
    });
    await run(own);
    expect(own.link?.evidence.yield).toMatchObject({ value: 4 });
  });

  it("reads the target only inside the caller's company", async () => {
    const state = targetState();
    const res = await run(state, { companyId: "co-2" });
    // The memory store answers nothing for another company: no link, so the
    // recipe is created for co-2 (never written into co-1's recipe).
    expect(state.inputs.map((i) => i.id)).toEqual(["t1"]);
    expect(res.ok).toBe(false);
  });
});

describe("pickCopyVersion", () => {
  const v = (id: string, status: string, n: number) => ({
    id,
    menu_item_id: "m",
    status,
    version_number: n,
    effective_date: null,
  });
  it("prefers the approved version in force, else the newest with lines", () => {
    const counts = new Map([
      ["a", 2],
      ["d", 3],
    ]);
    expect(
      pickCopyVersion([v("a", "approved", 1), v("d", "in_review", 2)], counts)
    ).toMatchObject({ status: "aprobada", version: { id: "a" } });
    expect(
      pickCopyVersion([v("d", "in_review", 2), v("e", "in_review", 3)], counts)
    ).toMatchObject({ status: "borrador", version: { id: "d" } });
    expect(pickCopyVersion([v("e", "in_review", 3)], counts)).toBeNull();
  });
});

/** A fake Supabase that records every eq() and answers from tables. */
function fakeSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    calls.push({ table, filters });
    const q: Record<string, unknown> = {};
    const rows = () =>
      (tables[table] ?? []).filter((r) =>
        filters.every(([c, v]) => r[c] === v)
      );
    q.select = () => q;
    q.eq = (c: string, v: unknown) => (filters.push([c, v]), q);
    q.in = () => q;
    q.limit = () => q;
    q.order = () => q;
    q.range = () => q;
    q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    q.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows(), error: null });
    return q;
  };
  return { client: { from } as never, calls };
}

describe("company scoping of the source", () => {
  const tables = {
    menu_items: [
      { id: "m-a", company_id: "co-1", name: "Plato A" },
      { id: "m-b", company_id: "co-2", name: "Plato de otra empresa" },
    ],
    recipe_versions: [
      {
        id: "va",
        company_id: "co-1",
        menu_item_id: "m-a",
        status: "approved",
        version_number: 1,
        effective_date: null,
      },
      {
        id: "vb",
        company_id: "co-2",
        menu_item_id: "m-b",
        status: "approved",
        version_number: 1,
        effective_date: null,
      },
    ],
    recipe_version_inputs: [
      { id: "x1", company_id: "co-1", recipe_version_id: "va" },
      { id: "x2", company_id: "co-2", recipe_version_id: "vb" },
    ],
    pos_product_links: [],
  };

  it("cannot load a recipe that belongs to another company", async () => {
    const { client } = fakeSupabase(tables);
    const store = { listInputs: vi.fn(async () => []) };
    expect(await loadCopySource(client, store, "co-1", "m-b")).toBeNull();
    expect(store.listInputs).not.toHaveBeenCalled();
  });

  it("lists only this company's platos with lines", async () => {
    const { client } = fakeSupabase(tables);
    const list = await listCopyCandidates(client, "co-1");
    expect(list.map((c) => c.menu_item_id)).toEqual(["m-a"]);
    expect(list[0]).toMatchObject({ status: "aprobada", line_count: 1 });
  });

  it("every source read is filtered by company_id", async () => {
    const { client, calls } = fakeSupabase(tables);
    const store = { listInputs: vi.fn(async () => []) };
    await loadCopySource(client, store, "co-1", "m-a");
    for (const call of calls) {
      expect(
        call.filters.some(([c, v]) => c === "company_id" && v === "co-1"),
        call.table
      ).toBe(true);
    }
    expect(store.listInputs).toHaveBeenCalledWith(
      "co-1",
      expect.objectContaining({ id: "va" })
    );
  });
});

// ---------------------------------------------------------------------------
// A target whose recipe is SHARED with another product (from «Usar la receta
// de otro plato») gets its OWN new recipe and link; the shared one is never
// written to.
// ---------------------------------------------------------------------------

describe("copy onto a product that shares its recipe with a sibling", () => {
  const sharedState = (draft: boolean) =>
    targetState({
      link: { id: "l1", menu_item_id: "m-shared", evidence: { keep: "x" } },
      version: {
        id: draft ? "v-shared-draft" : "v-shared-appr",
        status: draft ? "in_review" : "approved",
        kind: "dish",
        menu_item_id: "m-shared",
        version_number: 1,
      },
      inputs: [
        {
          id: "sh1",
          input_type: "ingredient",
          ingredient_id: "i-pollo",
          quantity: 5,
          unit: "oz",
          component_id: null,
        },
        {
          id: "sh2",
          input_type: "ingredient",
          ingredient_id: "i-sal",
          quantity: 1,
          unit: "g",
          component_id: null,
        },
      ],
    });

  /** createRecipeAndLink, modelled: ONLY this product's link is re-pointed. */
  function setup(draft: boolean) {
    const state = sharedState(draft);
    const sibling = {
      link: JSON.stringify(state.link),
      version: JSON.stringify(state.version),
      inputs: JSON.stringify(state.inputs),
    };
    const store = createMemoryEditorStore(state);
    const deleted: string[] = [];
    const realDelete = store.deleteInput.bind(store);
    store.deleteInput = async (...args: Parameters<typeof realDelete>) => {
      deleted.push(String(args[2]));
      return realDelete(...args);
    };
    const createRecipe = vi.fn(async () => {
      state.link = {
        id: "l1",
        menu_item_id: "m-own",
        evidence: { source: "create_recipe" },
      };
      state.version = {
        id: "v-own",
        status: "in_review",
        kind: "dish",
        menu_item_id: "m-own",
        version_number: 1,
      };
      state.inputs = [];
      return { ok: true as const };
    });
    const isRecipeShared = vi.fn(async (id: string) => id === "m-shared");
    return { state, sibling, store, deleted, createRecipe, isRecipeShared };
  }

  const exec = (
    ctx: ReturnType<typeof setup>,
    over: Partial<Parameters<typeof copyRecipeLinesForCompany>[0]> = {}
  ) =>
    copyRecipeLinesForCompany({
      store: ctx.store,
      loadSource: async (id) => (id === SOURCE.menu_item_id ? SOURCE : null),
      createRecipe: ctx.createRecipe,
      isRecipeShared: ctx.isRecipeShared,
      companyId: "co-1",
      odooProductId: 7,
      sourceMenuItemId: "m-src",
      ...over,
    });

  it("an approved shared recipe: the target gets its own new draft with the copied lines; the shared recipe, version, lines and link stay as they were", async () => {
    const ctx = setup(false);
    const res = await exec(ctx);
    expect(res).toMatchObject({
      ok: true,
      lines_copied: 2,
      created_recipe: true,
    });
    expect(ctx.createRecipe).toHaveBeenCalledTimes(1);
    // The target now has its own draft holding ONLY the copied lines.
    expect(ctx.state.link?.menu_item_id).toBe("m-own");
    expect(ctx.state.version).toMatchObject({
      id: "v-own",
      status: "in_review",
      menu_item_id: "m-own",
    });
    expect(
      ctx.state.inputs.map((i) => [i.ingredient_id, i.component_id])
    ).toEqual([
      ["i-res", null],
      [null, "c-chimi"],
    ]);
    // The shared recipe was never written to: nothing deleted, nothing inserted
    // into its version, and its snapshot is intact.
    expect(ctx.deleted).toEqual([]);
    expect(ctx.state.inputs.some((i) => i.id.startsWith("sh"))).toBe(false);
    expect(ctx.sibling.version).toContain("m-shared");
    expect(ctx.sibling.inputs).toContain("sh1");
  });

  it("replace mode on a shared DRAFT never deletes lines from the shared draft", async () => {
    const ctx = setup(true);
    const res = await exec(ctx, { mode: "replace" });
    expect(res).toMatchObject({ ok: true, created_recipe: true });
    // No shared line was deleted (the shared draft had sh1/sh2).
    expect(ctx.deleted.filter((id) => id.startsWith("sh"))).toEqual([]);
    expect(ctx.state.version?.id).toBe("v-own");
    expect(ctx.state.inputs).toHaveLength(2);
  });

  it("without a mode, a shared draft with lines does not ask or touch anything: the copy goes to the new recipe", async () => {
    const ctx = setup(true);
    const res = await exec(ctx);
    expect(res.ok).toBe(true);
    expect((res as { needs_mode?: boolean }).needs_mode).toBeUndefined();
    expect(ctx.deleted).toEqual([]);
  });

  it("the yield goes only to this product's own (new) link, never the shared one", async () => {
    const ctx = setup(false);
    const saved: Array<{ id: string | null; evidence: unknown }> = [];
    const realSave = ctx.store.saveEvidence.bind(ctx.store);
    ctx.store.saveEvidence = async (...args: Parameters<typeof realSave>) => {
      saved.push({ id: args[1].id, evidence: args[2] });
      return realSave(...args);
    };
    await exec(ctx);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("l1"); // this product's link, now pointing at m-own
    expect(ctx.state.link?.menu_item_id).toBe("m-own");
    expect(
      (saved[0].evidence as { yield?: { confirmed?: boolean } }).yield
    ).toMatchObject({ confirmed: false });
  });

  it("copying the recipe it shares with a sibling is allowed: it becomes an independent copy", async () => {
    const ctx = setup(false);
    const res = await exec(ctx, {
      sourceMenuItemId: "m-shared",
      loadSource: async () => ({ ...SOURCE, menu_item_id: "m-shared" }),
    });
    expect(res.ok).toBe(true);
    expect(ctx.state.link?.menu_item_id).toBe("m-own");
  });

  it("a recipe NOT shared is written as before (no new recipe)", async () => {
    const ctx = setup(false);
    ctx.isRecipeShared.mockResolvedValue(false);
    const res = await exec(ctx);
    expect(res).toMatchObject({ ok: true, created_recipe: false });
    expect(ctx.createRecipe).not.toHaveBeenCalled();
  });
});
