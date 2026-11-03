// ONE rule for «measured» (#407 follow-up): the preparation graph, the
// Preparaciones list row and the recipe editor must give the same answer for
// the same draft + version. Demo data only.
import { describe, expect, it, vi } from "vitest";

type Fixture = {
  name: string;
  version: { status: string; qty: number | null };
  /** The open draft's raw_values.yield, or undefined for a draft without one. */
  yieldRaw?: unknown;
  hasDraft: boolean;
  measured: boolean;
};

const FIXTURES: Fixture[] = [
  {
    name: "approved «rinde 6,5 kg» + an open draft with no yield reading",
    version: { status: "approved", qty: 6.5 },
    hasDraft: true,
    measured: true,
  },
  {
    name: "draft with a yield object but an invalid value (version 6,5)",
    version: { status: "in_review", qty: 6.5 },
    yieldRaw: { value: "abc", unit: "kg", confirmed: false },
    hasDraft: true,
    measured: true,
  },
  {
    name: "draft with a yield object but an invalid value (version default 1)",
    version: { status: "in_review", qty: 1 },
    yieldRaw: { value: 0, unit: "unit", source: "assumed" },
    hasDraft: true,
    measured: false,
  },
  {
    name: "draft with source «assumed»",
    version: { status: "in_review", qty: 1 },
    yieldRaw: { value: 1, unit: "unit", source: "assumed" },
    hasDraft: true,
    measured: false,
  },
  {
    name: "default 1, no draft",
    version: { status: "in_review", qty: 1 },
    hasDraft: false,
    measured: false,
  },
  {
    name: "a person confirmed the default 1 unit",
    version: { status: "in_review", qty: 1 },
    yieldRaw: {
      value: 1,
      unit: "unit",
      confirmed: true,
      source: "confirmed_default",
    },
    hasDraft: true,
    measured: true,
  },
];

// A stand-in for the database: every query returns the table's rows (the
// fixtures hold only matching ones). `.range(a, b)` pages.
let tables: Record<string, Array<Record<string, unknown>>> = {};
function fakeClient() {
  return {
    from(table: string) {
      const rows = () => tables[table] ?? [];
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "order", "neq", "is", "not"])
        chain[m] = () => chain;
      chain.range = (a: number, b: number) =>
        Promise.resolve({ data: rows().slice(a, b + 1), error: null });
      chain.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(ok);
      return chain;
    },
  } as never;
}

vi.mock("@/lib/restaurant/costing-versions", () => ({
  fetchCostingRecipeVersions: async () => ({
    componentRecipeVersionsByComponentId: new Map(
      (tables.component_recipe_versions ?? []).map((v) => [
        v.component_id as string,
        [v],
      ])
    ),
    componentRecipeVersionInputsByVersionId: new Map(),
    menuRecipeVersionsByMenuItemId: new Map(),
    menuRecipeVersionInputsByVersionId: new Map(),
  }),
}));
vi.mock("@/lib/restaurant/pos-product-list-server", () => ({
  loadPosProductList: async () => ({
    ok: true,
    list: { products: [], food_net_sales: 0 },
  }),
}));

import { loadPrepGraph } from "@/lib/restaurant/nested-yield-server";
import { loadPreparationsOverview } from "@/lib/restaurant/recipe-costing/preparations-server";
import { loadEditor } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  createMemoryEditorStore,
  memoryEditorState,
} from "./helpers/memory-editor-store";

function seed(f: Fixture) {
  tables = {
    component_recipe_versions: [
      {
        id: "cv1",
        component_id: "c1",
        version_number: 1,
        output_quantity: f.version.qty,
        output_unit: "kg",
        status: f.version.status,
      },
    ],
    component_recipe_version_inputs: [],
    prepared_components: [{ id: "c1", name: "Salsa demo" }],
    cost_import_review_items: f.hasDraft
      ? [
          {
            id: "h1",
            reason: "borrador",
            raw_values: {
              kind: "preparation_draft",
              component_id: "c1",
              ...(f.yieldRaw === undefined ? {} : { yield: f.yieldRaw }),
            },
          },
        ]
      : [],
  };
}

async function viaGraph() {
  const g = await loadPrepGraph(fakeClient(), "co-1");
  return g.get("c1")!.measured;
}
async function viaList() {
  const o = await loadPreparationsOverview(fakeClient(), {
    companyId: "co-1",
  });
  return !o.rows.find((r) => r.component_id === "c1")!.yield_to_confirm;
}
async function viaEditor(f: Fixture) {
  const state = memoryEditorState({
    ingredients: [],
    components: [{ id: "c1", name: "Salsa demo", output_unit: "kg" }],
    preparations: [
      {
        component_id: "c1",
        name: "Salsa demo",
        version: {
          id: "cv1",
          status: f.version.status,
          kind: "preparation",
          component_id: "c1",
          component_recipe_id: "cr1",
          output_quantity: f.version.qty ?? undefined,
          output_unit: "kg",
        },
        inputs: [],
        holder: f.hasDraft
          ? {
              id: "h1",
              evidence: f.yieldRaw === undefined ? {} : { yield: f.yieldRaw },
            }
          : null,
      },
    ],
  } as never);
  const r = await loadEditor({
    store: createMemoryEditorStore(state),
    companyId: "co-1",
    odooProductId: 0,
    locationId: null,
    componentId: "c1",
    userId: "u1",
  });
  return r.ok && r.state.preparation!.yield?.confirmed === true;
}

describe("one rule for «measured»", () => {
  it.each(FIXTURES)("$name", async (f) => {
    seed(f);
    const [graph, list, editor] = [
      await viaGraph(),
      await viaList(),
      await viaEditor(f),
    ];
    expect({ graph, list, editor }).toEqual({
      graph: f.measured,
      list: f.measured,
      editor: f.measured,
    });
  });
});
