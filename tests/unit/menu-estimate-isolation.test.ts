// Estimates are an overlay: the figures that matter never read them. Synthetic.

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { buildPosProductList } from "@/lib/restaurant/pos-product-list";
import type { PosProductLinkRecord } from "@/lib/restaurant/pos-product-links";
import {
  buildDishEconomics,
  type DishVersion,
} from "@/lib/restaurant/costing/dish-economics";
import {
  legacyMarginRows,
  periodCostKpisFromDishEconomics,
} from "@/lib/restaurant/costing/dish-economics-adapter";
import { loadDishEconomicsWith } from "@/lib/restaurant/costing/dish-economics-server";
import { evidenceLinesOf } from "@/lib/restaurant/recipe-costing/editor-service";
import {
  latestPrice,
  type VersionInput,
} from "@/lib/restaurant/recipe-costing/editor";
import type { CostingData } from "@/lib/restaurant/costing";
import { entry } from "./helpers/memory-editor-store";

vi.mock("@/lib/restaurant/currency", () => ({
  resolveCompanyCurrency: async () => "USD",
}));

const CO = "co-1";
const ESTIMATE_NAMES =
  /estimate-store|estimate-server|menu-reading\/estimate|restaurant_dish_estimates|ingredient_price_estimates/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("the figures never import the estimate store", () => {
  const roots = ["lib", "app", "components"];
  const all = roots.flatMap((r) => files(r));
  const figures = all.filter((f) => {
    const p = f.replace(/\\/g, "/");
    return (
      p.startsWith("lib/restaurant/costing/") ||
      /\/(briefing|ask-milton|profitability|cockpit)[^/]*(\/|\.)/.test(p) ||
      /^lib\/restaurant\/(briefing|ask-milton|profitability|cockpit)/.test(p)
    );
  });

  it("finds the files it checks", () => {
    expect(figures.length).toBeGreaterThan(10);
    expect(figures.some((f) => f.includes("dish-economics.ts"))).toBe(true);
  });

  it("none of them mentions the estimate store, server or tables", () => {
    const offenders = figures.filter((f) =>
      ESTIMATE_NAMES.test(readFileSync(f, "utf8"))
    );
    expect(offenders).toEqual([]);
  });

  it("only the allowed screens and routes import estimate-store", () => {
    const importers = all
      .filter((f) =>
        readFileSync(f, "utf8").includes("menu-reading/estimate-store")
      )
      .map((f) => f.replace(/\\/g, "/"));
    for (const f of importers) {
      expect(f).not.toMatch(
        /costing\/|briefing|ask-milton|profitability|cockpit|kpi/i
      );
    }
  });
});

// A small company: one approved dish, one menu draft (no recipe lines yet).
function link(
  productId: number,
  over: Partial<PosProductLinkRecord>
): PosProductLinkRecord {
  return {
    company_id: CO,
    location_id: null,
    odoo_product_id: productId,
    odoo_name: `P${productId}`,
    classification: "plato_preparado",
    menu_item_id: null,
    link_state: "confirmado",
    confirmed_by: null,
    confirmed_at: null,
    confirmed_how: null,
    evidence: {},
    ...over,
  };
}

function economics(withDraftQuantities: boolean, confirmedDraft = false) {
  const entries = [entry("i-carne", "oz", 0.5)];
  const costing = {
    ingredientsById: new Map([
      ["i-carne", { id: "i-carne", name: "Carne", default_unit: "oz" }],
    ]),
    componentsById: new Map(),
    componentRecipesByComponentId: new Map(),
    componentRecipeInputsByRecipeId: new Map(),
    menuItemsById: new Map(),
    menuRecipesByMenuItemId: new Map(),
    menuRecipeInputsByRecipeId: new Map(),
    costEntriesByIngredientId: new Map([["i-carne", entries]]),
  } as unknown as CostingData;
  const draftLines = [
    {
      raw_name: "pollo",
      qty: withDraftQuantities ? 200 : null,
      unit: withDraftQuantities ? "g" : null,
      pending: true,
      flags: withDraftQuantities
        ? ["pendiente_ingrediente", "estimado_milton"]
        : ["pendiente_ingrediente", "pendiente_cantidad"],
    },
  ];
  const links = [
    link(1, { menu_item_id: "m1", evidence: { lines: [] } }),
    link(2, {
      menu_item_id: "m2",
      link_state: confirmedDraft ? "confirmado" : "sugerido",
      evidence: { source: "menu", lines: draftLines },
    }),
  ];
  const versions: DishVersion[] = [
    {
      id: "v1",
      menu_item_id: "m1",
      version_number: 1,
      status: "approved",
      effective_date: null,
      approved_at: "2026-10-01T10:00:00Z",
    },
    {
      id: "v2",
      menu_item_id: "m2",
      version_number: 1,
      status: "in_review",
      effective_date: null,
    },
  ];
  const sales = [
    {
      company_id: CO,
      raw_item_name: "P1",
      quantity: 10,
      gross_revenue: 200,
      net_revenue: 200,
      source_metadata: { product_id: 1 },
    },
    {
      company_id: CO,
      raw_item_name: "P2",
      quantity: 5,
      gross_revenue: 50,
      net_revenue: 50,
      source_metadata: { product_id: 2 },
    },
  ];
  return buildDishEconomics({
    companyId: CO,
    currency: "USD",
    list: buildPosProductList({
      companyId: CO,
      sales,
      links,
      recipeVersions: versions.map((v) => ({
        menu_item_id: v.menu_item_id,
        status: v.status,
      })),
    }),
    links,
    versions,
    inputsByVersionId: new Map<string, VersionInput[]>([
      [
        "v1",
        [
          {
            id: "a1",
            input_type: "ingredient",
            ingredient_id: "i-carne",
            component_id: null,
            quantity: 6,
            unit: "oz",
          },
        ],
      ],
    ]),
    costing,
    evidenceLinesOf,
    priceOf: (id) => latestPrice(costing, id, () => "lista"),
  });
}

describe("dish economics are the same with or without a used estimate", () => {
  const before = economics(false);
  const after = economics(true);

  it("statuses, coverage, COGS and counts do not move", () => {
    expect(after.totals).toEqual(before.totals);
    expect(
      after.dishes.map((d) => [d.odoo_product_id, d.status, d.covered])
    ).toEqual(
      before.dishes.map((d) => [d.odoo_product_id, d.status, d.covered])
    );
    expect(legacyMarginRows(after)).toEqual(legacyMarginRows(before));
    expect(periodCostKpisFromDishEconomics(after)).toEqual(
      periodCostKpisFromDishEconomics(before)
    );
  });

  it("the draft dish is never «aprobado» and never covered", () => {
    const draft = after.dishes.find((d) => d.odoo_product_id === 2)!;
    expect(draft.status).not.toBe("aprobado");
    expect(draft.covered).toBe(false);
    expect(draft.unit_cost).toBeNull();
    expect(after.totals.covered_net_sales).toBe(200);
  });
});

describe("a Confirmado plato with no recipe: an estimate or a menu draft moves no figure", () => {
  const before = economics(false, true);
  const after = economics(true, true);

  it("KPIs, Cockpit rollup inputs and briefing inputs are unchanged", () => {
    // Cockpit, briefing and the KPIs all read these three views.
    expect(after.totals).toEqual(before.totals);
    expect(legacyMarginRows(after)).toEqual(legacyMarginRows(before));
    expect(periodCostKpisFromDishEconomics(after)).toEqual(
      periodCostKpisFromDishEconomics(before)
    );
    expect(
      after.dishes.map((d) => [d.odoo_product_id, d.status, d.covered])
    ).toEqual(
      before.dishes.map((d) => [d.odoo_product_id, d.status, d.covered])
    );
  });

  it("the plato is never «aprobado» or covered, has no cost and is out of COGS", () => {
    const plato = after.dishes.find((d) => d.odoo_product_id === 2)!;
    // Its pending menu-draft lines make it «Falta precio»; never a real status.
    expect(plato.status).toBe("falta_precio");
    expect(plato.covered).toBe(false);
    expect(plato.unit_cost).toBeNull();
    expect(after.totals.covered_net_sales).toBe(200);
  });
});

describe("loading dish economics never reads the estimate tables", () => {
  it("asks for no estimate table", async () => {
    const asked: string[] = [];
    const empty: unknown = new Proxy(() => empty, {
      get: (_t, prop) =>
        prop === "then"
          ? (resolve: (v: unknown) => void) =>
              resolve({ data: [], error: null, count: 0 })
          : empty,
      apply: () => empty,
    });
    const supabase = {
      from: (table: string) => {
        asked.push(table);
        return empty;
      },
      rpc: (name: string) => {
        asked.push(`rpc:${name}`);
        return empty;
      },
    };
    await loadDishEconomicsWith(supabase as never, { companyId: CO });
    expect(asked.length).toBeGreaterThan(3);
    expect(asked.filter((t) => ESTIMATE_NAMES.test(t))).toEqual([]);
  });
});
