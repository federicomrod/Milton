import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type { RankedPosProduct } from "@/lib/restaurant/pos-product-list";
import { TREATMENT_RULES } from "@/lib/restaurant/pos-treatments";
import {
  TREATMENT_MIGRATION_ERROR,
  TREATMENT_ROLE_ERROR,
  setPosProductTreatments,
} from "@/lib/restaurant/recipe-costing/link-actions-server";
import { buildRecipeCostingWorkspace } from "@/lib/restaurant/recipe-costing/workspace";
import { wantsSuggestion } from "@/lib/restaurant/recipe-suggestion-server";

import {
  fakeLinksSupabase as fakeSupabase,
  type Row,
} from "./helpers/fake-links-supabase";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const owner = { user_id: "u-1", role: "owner", is_milton_staff: false };

describe("saving a treatment", () => {
  it("changes only the classification and records who chose it", async () => {
    const rows: Row[] = [
      {
        id: "l-1",
        company_id: "co-a",
        location_id: null,
        odoo_product_id: 7,
        odoo_name: "Propina",
        classification: "por_clasificar",
        menu_item_id: "m-1",
        link_state: "sugerido",
        confirmed_by: null,
        confirmed_at: null,
        confirmed_how: null,
        evidence: { source: "ai", block_name: "X" },
      },
    ];
    const result = await setPosProductTreatments({
      supabase: fakeSupabase(rows),
      companyId: "co-a",
      actor: owner,
      items: [
        { odoo_product_id: 7, odoo_name: "Propina", treatment: "excluido" },
        {
          odoo_product_id: 8,
          odoo_name: "Coca-Cola",
          treatment: "reventa",
          source: "sugerencia",
        },
      ],
      source: "manual",
    });
    expect(result).toEqual({ ok: true, saved: 2 });
    const tip = rows.find((r) => r.odoo_product_id === 7)!;
    expect(tip.classification).toBe("excluido");
    expect(tip.link_state).toBe("sugerido");
    expect(tip.menu_item_id).toBe("m-1");
    expect((tip.evidence as Row).block_name).toBe("X");
    expect((tip.evidence as Row).treatment).toMatchObject({
      value: "excluido",
      previous: "por_clasificar",
      by: "u-1",
      source: "manual",
    });
    const soda = rows.find((r) => r.odoo_product_id === 8)!;
    expect(soda.classification).toBe("reventa");
    expect(soda.link_state).toBe("sin_vincular");
    expect((soda.evidence as Row).treatment).toMatchObject({
      source: "sugerencia",
    });
  });

  it("a viewer cannot classify", async () => {
    const result = await setPosProductTreatments({
      supabase: fakeSupabase([]),
      companyId: "co-a",
      actor: { user_id: "u", role: "viewer", is_milton_staff: false },
      items: [{ odoo_product_id: 1, odoo_name: "X", treatment: "excluido" }],
      source: "manual",
    });
    expect(result).toEqual({ ok: false, error: TREATMENT_ROLE_ERROR });
  });

  it("explains a missing migration 040 instead of failing", async () => {
    const result = await setPosProductTreatments({
      supabase: fakeSupabase([], { rejectNewValues: true }),
      companyId: "co-a",
      actor: owner,
      items: [{ odoo_product_id: 1, odoo_name: "X", treatment: "reventa" }],
      source: "manual",
    });
    expect(result).toEqual({ ok: false, error: TREATMENT_MIGRATION_ERROR });
  });

  it("por_clasificar is not a choice", async () => {
    const result = await setPosProductTreatments({
      supabase: fakeSupabase([]),
      companyId: "co-a",
      actor: owner,
      items: [
        { odoo_product_id: 1, odoo_name: "X", treatment: "por_clasificar" },
      ],
      source: "manual",
    });
    expect(result.ok).toBe(false);
  });
});

function product(
  id: number,
  name: string,
  net: number,
  partial: Partial<RankedPosProduct> = {}
): RankedPosProduct {
  const classification = partial.classification ?? "por_clasificar";
  const treatment = partial.treatment ?? classification;
  return {
    odoo_product_id: id,
    odoo_name: name,
    net_sales: net,
    share_of_net_sales: 0,
    units_sold: 1,
    category: null,
    is_combo: false,
    components: [],
    excluded_parts: [],
    classification_label: "",
    suggested_treatment: null,
    in_food_sales: TREATMENT_RULES[treatment].in_food_sales,
    share_of_food_sales: 0,
    link_state: "sin_vincular",
    link_state_label: "Sin vincular",
    menu_item_id: null,
    counts_toward_coverage: false,
    ...partial,
    classification,
    treatment,
  };
}

function workspace(products: RankedPosProduct[]) {
  return buildRecipeCostingWorkspace({
    companyId: "co-a",
    companyName: null,
    currency: "USD",
    periodLabel: null,
    view: "resumen",
    actor: { user_id: "u", role: "owner", is_milton_staff: false },
    products,
    links: [],
    versions: [],
    menuItems: [],
    batches: [],
    coveragePct: 0,
    netSales: 80,
    excludedNetSales: 20,
    coveredNetSales: 0,
  });
}

describe("workspace — treatments on Resumen and Vincular", () => {
  const products = [
    product(1, "Pollo", 50, {
      share_of_food_sales: 0.625,
      suggested_treatment: {
        treatment: "plato_preparado",
        reason: "Se vende como plato",
      },
    }),
    product(2, "Coca-Cola", 30, {
      classification: "reventa",
      share_of_food_sales: 0.375,
    }),
    product(3, "Propina", 20, { classification: "excluido" }),
  ];

  it("queues unclassified products with Milton's suggestion, top sellers first", () => {
    const ws = workspace(products);
    expect(ws.classify_queue.map((r) => r.odoo_name)).toEqual(["Pollo"]);
    expect(ws.classify_queue[0]).toMatchObject({
      suggested: "plato_preparado",
      suggested_label: "Plato preparado",
      share_label: "62.5%",
    });
    expect(ws.treatment_options.map((o) => o.id)).not.toContain(
      "por_clasificar"
    );
  });

  it("orders Qué falta by share of food sales and asks reventa what you buy", () => {
    const ws = workspace(products);
    expect(ws.todos.map((t) => t.odoo_name)).toEqual(["Pollo", "Coca-Cola"]);
    const soda = ws.todos.find((t) => t.odoo_product_id === 2)!;
    expect(soda.kind).toBe("reventa");
    expect(soda.action_label).toBe("Elegir qué compras");
    expect(ws.todos.some((t) => t.odoo_product_id === 3)).toBe(false);
  });

  it("says what was left out of coverage", () => {
    const ws = workspace(products);
    expect(ws.coverage.excluded_note).toMatch(/no es comida/);
    const excluded = ws.classification.find((r) => r.id === "excluido")!;
    expect(excluded.count).toBe(1);
    expect(excluded.share_label).toMatch(/de todas las ventas/);
    expect(ws.classify_queue).toHaveLength(1);
  });

  it("the excluded product shows no food share", () => {
    const ws = workspace(products);
    const tip = ws.products.find((p) => p.odoo_product_id === 3)!;
    expect(tip.in_food_sales).toBe(false);
    expect(tip.share_label).toBe("—");
  });
});

describe("Generar sugerencias skips products that take no recipe from the file", () => {
  it("keeps dishes, costed modifiers and unclassified products", () => {
    expect(wantsSuggestion(product(1, "A", 1))).toBe(true);
    expect(
      wantsSuggestion(product(1, "A", 1, { classification: "plato_preparado" }))
    ).toBe(true);
    expect(
      wantsSuggestion(
        product(1, "A", 1, { classification: "modificador_con_costo" })
      )
    ).toBe(true);
    for (const c of [
      "reventa",
      "modificador_sin_costo",
      "combo",
      "excluido",
    ] as const) {
      expect(wantsSuggestion(product(1, "A", 1, { classification: c }))).toBe(
        false
      );
    }
    expect(wantsSuggestion(product(1, "A", 1, { is_combo: true }))).toBe(false);
  });
});

describe("treatment and resale routes", () => {
  const files = [
    "app/api/restaurant/pos/links/treatment/route.ts",
    "app/api/restaurant/pos/links/resale/route.ts",
  ];

  it("take the company from auth and export only handlers", () => {
    for (const file of files) {
      const src = read(file);
      expect(src).toContain("authAndCompany");
      expect(src).not.toMatch(/body\.company_id/);
      const names = [
        ...src.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm),
      ].map((m) => m[1]);
      for (const name of names) {
        expect(["POST", "dynamic", "runtime"], file).toContain(name);
      }
    }
  });

  it("resale makes a draft: it never confirms a link or approves a recipe", () => {
    const src = read("lib/restaurant/recipe-costing/resale-server.ts");
    expect(src).toContain("actorCanSubmitForApproval");
    expect(src).toContain('action: "add"');
    expect(src).not.toMatch(/confirmPosLink|approve|"approved"|confirmado/);
  });

  it("copy is Spanish with tú", () => {
    const ui = read("components/restaurant/recipes-costing/TreatmentPanel.tsx");
    // B6/C1: a compact selector in the dish header; the suggestion is
    // in its tooltip.
    expect(ui).toContain('aria-label="Cómo se costea"');
    expect(ui).toContain("Milton sugiere");
    expect(ui).toContain("¿Qué compras para venderlo?");
    expect(ui).not.toMatch(/\busted\b/i);
  });
});

describe("migration 040", () => {
  const sql = read("supabase/migrations/040_pos_product_treatments.sql");
  const statements = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("is marked as not additive and only swaps the CHECK", () => {
    expect(sql).toMatch(/NOT ADDITIVE/);
    expect(statements).toContain(
      "DROP CONSTRAINT IF EXISTS pos_product_links_classification_chk"
    );
    expect(statements).not.toMatch(/DROP (TABLE|COLUMN|POLICY|INDEX)/i);
    expect(statements).not.toMatch(/\bUPDATE\b|\bDELETE\b/i);
    expect(statements).not.toMatch(/ALTER COLUMN/i);
  });

  it("allows every treatment and keeps the pre-040 values", () => {
    for (const value of [
      "por_clasificar",
      ...Object.keys(TREATMENT_RULES),
      "requiere_receta",
      "componente",
      "no_requiere_costeo",
    ]) {
      expect(statements).toContain(`'${value}'`);
    }
  });
});
