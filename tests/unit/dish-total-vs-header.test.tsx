// The dish header, the list badge and the table's footer are ONE number on an
// approved recipe: the live sum of the lines. Synthetic names and prices.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { pickApprovedVersion } from "@/lib/restaurant/recipe-versions";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import {
  evidenceLinesOf,
  loadEditor,
} from "@/lib/restaurant/recipe-costing/editor-service";
import { latestPrice } from "@/lib/restaurant/recipe-costing/editor";
import { summaryFromEditorState } from "@/lib/restaurant/recipe-costing/optimistic";
import {
  DishTotalRow,
  pendingReasonOf,
} from "@/components/restaurant/recipes-costing/RecipeLinesEditor";
import {
  createMemoryEditorStore,
  entry,
  memoryEditorState,
} from "./helpers/memory-editor-store";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CO = "co-1";

const ING = [
  { id: "i-choriz", name: "Chorizo de prueba", default_unit: "oz" },
  { id: "i-res", name: "Res de prueba", default_unit: "oz" },
];
const line = (id: string, ing: string, qty: number, unit: string) => ({
  id,
  input_type: "ingredient" as const,
  ingredient_id: ing,
  component_id: null,
  quantity: qty,
  unit,
  unit_cost: null,
  cost_source: null,
});
/** An OLD unit question saved in the evidence (Excel unit vs suggested unit). */
const staleQuestion = (
  inputId: string,
  name: string,
  qty: number,
  unit: string
) => ({
  raw_name: name.toUpperCase(),
  ingredient_match: name,
  qty,
  unit,
  input_id: inputId,
  unit_question: { written: unit, suggested: "oz" },
  flags: [],
  reasons: [],
});

// -------------------------------------------------------------------------
// The shared world: economics (the header) + the editor (the table)
// -------------------------------------------------------------------------
function economicsFor(opts: {
  entries: ReturnType<typeof entry>[];
  lines: ReturnType<typeof line>[];
  evidence: Record<string, unknown>;
  status?: "approved" | "in_review";
  versions?: Array<{
    id: string;
    n: number;
    status: "approved" | "in_review";
    effective_date?: string | null;
    lines: ReturnType<typeof line>[];
  }>;
}) {
  const data = {
    ingredientsById: new Map(ING.map((i) => [i.id, i])),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map(
      ING.map((i) => [
        i.id,
        opts.entries.filter((e) => e.ingredient_id === i.id),
      ])
    ),
  } as never;
  const versionDefs = opts.versions ?? [
    { id: "v1", n: 1, status: opts.status ?? "approved", lines: opts.lines },
  ];
  const versions: DishVersion[] = versionDefs.map((v) => ({
    id: v.id,
    menu_item_id: "m7",
    version_number: v.n,
    status: v.status,
    effective_date: v.effective_date ?? null,
    approved_at: v.status === "approved" ? "2026-10-01T10:00:00Z" : null,
    created_at: "2026-10-01T10:00:00Z",
  }));
  const sales = [
    {
      company_id: CO,
      raw_item_name: "Parrillada de prueba",
      quantity: 10,
      gross_revenue: 400,
      net_revenue: 400,
      source_metadata: { product_id: 7 },
    },
  ];
  const links = [
    {
      company_id: CO,
      location_id: null,
      odoo_product_id: 7,
      odoo_name: "Parrillada de prueba",
      classification: "plato_preparado",
      menu_item_id: "m7",
      link_state: "confirmado",
      confirmed_by: null,
      confirmed_at: null,
      confirmed_how: null,
      evidence: opts.evidence,
    },
  ] as never;
  const list = buildPosProductList({
    companyId: CO,
    sales: sales as never,
    links,
    recipeVersions: versions.map((v) => ({
      menu_item_id: "m7",
      status: v.status,
    })) as never,
  });
  const result = buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list,
    links,
    versions,
    inputsByVersionId: new Map(
      versionDefs.map((v) => [v.id, v.lines.map((l) => ({ ...l })) as never])
    ),
    costing: data,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(data, id, () => "lista"),
  });
  return result.dishes[0];
}
function editorCtx(opts: {
  entries: ReturnType<typeof entry>[];
  lines: ReturnType<typeof line>[];
  evidence: Record<string, unknown>;
  status?: "approved" | "in_review";
  extra?: Parameters<typeof memoryEditorState>[0];
}) {
  const state = memoryEditorState({
    ingredients: ING,
    entries: [...opts.entries],
    version: {
      id: "v1",
      status: opts.status ?? "approved",
      kind: "dish",
      menu_item_id: "m7",
    },
    inputs: opts.lines.map((l) => ({ ...l })),
    link: { id: "link-1", menu_item_id: "m7", evidence: opts.evidence },
    ...opts.extra,
  });
  return {
    state,
    ctx: {
      store: createMemoryEditorStore(state),
      companyId: CO,
      odooProductId: 7,
      locationId: null,
      userId: "u1",
    },
  };
}
const totalRowText = (lines: Parameters<typeof DishTotalRow>[0]["lines"]) =>
  renderToString(
    createElement(
      "table",
      null,
      createElement("tbody", null, createElement(DishTotalRow, { lines }))
    )
  )
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

// -------------------------------------------------------------------------
describe("approved recipe, every line priced, an OLD unit question in the evidence", () => {
  // CHORIZO 3 unidad at $0.31 per unidad? no: priced per oz, line in oz; the
  // old question (Excel «onza» vs suggested «unit») is still saved.
  const lines = [line("l1", "i-choriz", 3, "oz"), line("l2", "i-res", 6, "oz")];
  const entries = [entry("i-choriz", "oz", 0.31), entry("i-res", "oz", 0.5)];
  const evidence = {
    lines: [
      staleQuestion("l1", "Chorizo de prueba", 3, "oz"),
      staleQuestion("l2", "Res de prueba", 6, "oz"),
    ],
  };
  const live = 3 * 0.31 + 6 * 0.5;

  it("the header (dish economics) says Aprobado with the live total", () => {
    const d = economicsFor({ entries, lines, evidence });
    expect(d.status).toBe("aprobado");
    expect(d.lines_missing_price).toBe(0);
    expect(d.unit_cost).toBeCloseTo(live, 10);
  });
  it("the table (editor) agrees: no line is pending because of the old question; footer = header", async () => {
    const d = economicsFor({ entries, lines, evidence });
    const { ctx } = editorCtx({ entries, lines, evidence });
    const r = await loadEditor(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(
      r.state.lines.every((l) => !l.pending && l.unit_question === null)
    ).toBe(true);
    expect(r.state.total_cost).toBeCloseTo(live, 10);
    expect(r.state.total_cost).toBeCloseTo(d.unit_cost!, 10);
    expect(totalRowText(r.state.lines)).toContain("$3.93");
  });
  it("a DRAFT keeps the question pending (it can be answered there)", async () => {
    const { ctx } = editorCtx({
      entries,
      lines,
      evidence,
      status: "in_review",
    });
    const r = await loadEditor(ctx);
    expect(r.ok && r.state.lines.every((l) => l.pending)).toBe(true);
  });
});

describe("the same, but the price unit does NOT convert", () => {
  const lines = [line("l1", "i-choriz", 3, "oz"), line("l2", "i-res", 6, "oz")];
  // CHORIZO is priced per «unit»: oz cannot be read in it
  const entries = [entry("i-choriz", "unit", 0.31), entry("i-res", "oz", 0.5)];
  const evidence = {
    lines: [staleQuestion("l1", "Chorizo de prueba", 3, "oz")],
  };
  it("Falta precio; the header names the line; the footer says Sin precio and shows no stale $ total", async () => {
    const d = economicsFor({ entries, lines, evidence });
    expect(d.status).toBe("falta_precio");
    expect(d.unit_cost).toBeNull();
    expect(d.lines_missing_price).toBe(1);
    const { ctx } = editorCtx({ entries, lines, evidence });
    const r = await loadEditor(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.total_cost).toBeNull();
    const pending = r.state.lines.filter((l) => l.amount === null);
    expect(pending.map((l) => l.name)).toEqual(["Chorizo de prueba"]);
    const text = totalRowText(r.state.lines);
    expect(text).toContain("Sin precio · 1 línea pendiente");
    expect(text).not.toMatch(/\$\d/);
    // and the header component names it
    const src = read("components/restaurant/recipes-costing/PlatoScreen.tsx");
    expect(src).toContain('data-testid="header-pending"');
    expect(read("lib/i18n/es/menu-workspace.ts")).toContain("línea pendiente");
  });
  it("each pending line says why: Unidad distinta / Falta precio / Unidad por confirmar", async () => {
    const { ctx } = editorCtx({
      entries: [entry("i-choriz", "unit", 0.31)],
      lines: [line("l1", "i-choriz", 3, "oz"), line("l2", "i-res", 6, "oz")],
      evidence: {},
    });
    const r = await loadEditor(ctx);
    if (!r.ok) throw new Error("no state");
    expect(pendingReasonOf(r.state.lines[0])).toBe("Unidad distinta");
    expect(pendingReasonOf(r.state.lines[1])).toBe("Falta precio"); // no price at all
    expect(
      pendingReasonOf({
        ...r.state.lines[1],
        unit_question: { written: "oz", suggested: "unit" },
      })
    ).toBe("Unidad por confirmar");
  });
});

describe("a preparation line with its own cost is not pending", () => {
  it("costs from its own price and does not block the total", async () => {
    const { ctx } = editorCtx({
      entries: [entry("i-res", "oz", 0.5)],
      lines: [line("l1", "i-res", 6, "oz")],
      evidence: {},
      extra: {
        components: [
          { id: "c-chim", name: "Chimichurri de prueba", output_unit: "oz" },
        ],
        inputs: [
          line("l1", "i-res", 6, "oz"),
          {
            id: "l2",
            input_type: "component",
            ingredient_id: null,
            component_id: "c-chim",
            quantity: 2,
            unit: "oz",
            unit_cost: 0.4,
            cost_source: "manual",
          } as never,
        ],
      },
    });
    const r = await loadEditor(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const prep = r.state.lines.find((l) => l.kind === "component")!;
    expect(prep.pending).toBe(false);
    expect(prep.amount).toBeCloseTo(0.8, 10);
    expect(r.state.total_cost).toBeCloseTo(3 + 0.8, 10);
  });
});

describe("the footer is never the stored evidence", () => {
  it("portion_cost_label no longer comes from evidence.milton_cost", () => {
    const src = read("lib/restaurant/recipe-costing/workspace.ts");
    expect(src).toMatch(/portion_cost_label: null/);
    expect(src).not.toMatch(/portion_cost_label:\s*\n?\s*portionCost/);
  });
  it("the editor footer is the live sum of its own lines, even when a stored cost says otherwise", () => {
    const lines = [
      { amount: 2, pending: false },
      { amount: 3.87, pending: false },
    ] as never;
    // a stored «milton_cost» of 18.09 is nowhere in the footer
    expect(totalRowText(lines)).toContain("$5.87");
    expect(totalRowText(lines)).not.toContain("18.09");
  });
});

describe("the header follows the approved recipe after a price fix", () => {
  const summary = (over: Record<string, unknown> = {}) =>
    ({
      odoo_product_id: 7,
      status: "falta_precio",
      status_label: "Falta precio",
      unit_cost: null,
      avg_net_price: 40,
      food_cost_pct: null,
      unit_margin: null,
      excel_total: 5.96,
      excel_diff: null,
      excel_diff_flag: false,
      lines_missing_price: 1,
      covered: false,
      in_cogs: false,
      treatment: "plato_preparado",
      has_approved_version: true,
      link_confirmed: true,
      ...over,
    }) as never;
  const fixed = {
    editable: false,
    total_cost: 5.87,
    pending: 0,
    lines: [{ amount: 5.87, pending: false }],
  } as never;

  it("approved + price fixed: the header becomes Aprobado with the table's total", () => {
    const next = summaryFromEditorState(summary(), fixed);
    expect(next).toMatchObject({
      status: "aprobado",
      covered: true,
      lines_missing_price: 0,
    });
    expect(next.unit_cost).toBeCloseTo(5.87, 10);
    expect(next.food_cost_pct).toBeCloseTo((5.87 / 40) * 100, 10);
  });
  it("still missing: the header stays Falta precio, never a partial total", () => {
    const next = summaryFromEditorState(summary(), {
      editable: false,
      total_cost: null,
      pending: 1,
      lines: [{ amount: null, pending: true }],
    } as never);
    expect(next.status).toBe("falta_precio");
    expect(next.unit_cost).toBeNull();
  });
  it("a newer DRAFT being edited does not change the approved header", () => {
    const approved = summary({
      status: "aprobado",
      unit_cost: 5,
      covered: true,
    });
    expect(
      summaryFromEditorState(approved, {
        ...(fixed as object),
        editable: true,
      } as never)
    ).toBe(approved);
  });
  it("an unconfirmed link stays «Aprobado · vínculo sin confirmar»", () => {
    const next = summaryFromEditorState(
      summary({ link_confirmed: false }),
      fixed
    );
    expect(next).toMatchObject({
      status: "aprobado",
      covered: false,
      state_reason: "vinculo_sin_confirmar",
    });
  });
});

describe("two approved versions with no date: the same one everywhere", () => {
  const v = (id: string, n: number) => ({
    id,
    version_number: n,
    status: "approved",
    effective_date: null,
  });
  it("pickApprovedVersion takes the HIGHEST started number, whatever the order of the array", () => {
    expect(pickApprovedVersion([v("v1", 1), v("v2", 2)])?.id).toBe("v2");
    expect(pickApprovedVersion([v("v2", 2), v("v1", 1)])?.id).toBe("v2");
    expect(pickApprovedVersion([v("v3", 3), v("v1", 1), v("v2", 2)])?.id).toBe(
      "v3"
    );
  });
  it("two undated approved versions in reverse order: economics costs v2 and so does the editor (no override needed)", async () => {
    const v1 = [line("a1", "i-res", 4, "oz")];
    const v2 = [line("b1", "i-res", 8, "oz")];
    const entries = [entry("i-res", "oz", 0.5)];
    const d = economicsFor({
      entries,
      lines: v1,
      evidence: {},
      // newest first: reverse order
      versions: [
        { id: "v2", n: 2, status: "approved", lines: v2 },
        { id: "v1", n: 1, status: "approved", lines: v1 },
      ],
    });
    expect(d.recipe_version_id).toBe("v2");
    expect(d.unit_cost).toBeCloseTo(4, 10);
    const { ctx } = editorCtx({
      entries,
      lines: v2,
      evidence: {},
      extra: {
        version: {
          id: "v2",
          status: "approved",
          kind: "dish",
          menu_item_id: "m7",
          version_number: 2,
          effective_date: null,
        },
      },
    });
    const r = await loadEditor(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version_id).toBe("v2");
    expect(r.state.version_note).toBeNull();
    expect(r.state.total_cost).toBeCloseTo(d.unit_cost!, 10);
  });

  it("an undated v3 after a dated v2: economics costs v3", () => {
    const entries = [entry("i-res", "oz", 0.5)];
    const d = economicsFor({
      entries,
      lines: [],
      evidence: {},
      versions: [
        {
          id: "v3",
          n: 3,
          status: "approved",
          lines: [line("c1", "i-res", 10, "oz")],
        },
        {
          id: "v1",
          n: 1,
          status: "approved",
          lines: [line("a1", "i-res", 4, "oz")],
        },
        {
          id: "v2",
          n: 2,
          status: "approved",
          effective_date: "2026-09-01",
          lines: [line("b1", "i-res", 8, "oz")],
        },
      ],
    });
    expect(d.recipe_version_id).toBe("v3");
    expect(d.unit_cost).toBeCloseTo(5, 10);
  });

  it("a newest version that has not started: economics costs the one in force and the editor shows it, saying so", async () => {
    const v2 = [line("b1", "i-res", 8, "oz")];
    const v3 = [line("c1", "i-res", 10, "oz")];
    const entries = [entry("i-res", "oz", 0.5)];
    const d = economicsFor({
      entries,
      lines: [],
      evidence: {},
      versions: [
        {
          id: "v3",
          n: 3,
          status: "approved",
          effective_date: "2999-01-01",
          lines: v3,
        },
        { id: "v2", n: 2, status: "approved", lines: v2 },
      ],
    });
    expect(d.recipe_version_id).toBe("v2");
    const { ctx } = editorCtx({
      entries,
      lines: v3,
      evidence: {},
      extra: {
        version: {
          id: "v3",
          status: "approved",
          kind: "dish",
          menu_item_id: "m7",
          version_number: 3,
          effective_date: "2999-01-01",
        },
        inForceVersion: {
          id: "v2",
          status: "approved",
          kind: "dish",
          menu_item_id: "m7",
          version_number: 2,
          effective_date: null,
        },
        olderVersions: [
          {
            version: {
              id: "v2",
              status: "approved",
              kind: "dish",
              menu_item_id: "m7",
            },
            inputs: v2.map((l) => ({ ...l })),
          },
        ],
      },
    });
    const r = await loadEditor(ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.version_id).toBe("v2");
    expect(r.state.total_cost).toBeCloseTo(d.unit_cost!, 10);
    expect(r.state.version_note).toContain("versión aprobada en vigor");
    expect(r.state.version_note).toContain("2999-01-01");
  });
});

describe("no banner on approved recipes", () => {
  it("the orange banner is gone (one muted line + the price controls replace it); «Crear versión nueva» is in the ⋯ menu", () => {
    const src = read(
      "components/restaurant/recipes-costing/RecipeLinesEditor.tsx"
    );
    expect(src).not.toContain('data-testid="approved-pending-banner"');
    expect(src).not.toContain(
      "Corrige el precio del ingrediente (no hace falta versión nueva) o"
    );
    expect(src).toMatch(/<DropdownMenuItem[\s\S]{0,160}d\.lines\.newVersion/);
    expect(read("lib/i18n/es/menu-editor.ts")).toContain(
      'newVersion: "Crear versión nueva"'
    );
  });
});
