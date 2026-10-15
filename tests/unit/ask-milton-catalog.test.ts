// R1-16c: Ask Milton's price and menu blocks. Synthetic.
import { describe, expect, it } from "vitest";
import {
  buildIngredientPrices,
  buildItemGroups,
  buildMenuDishes,
} from "@/lib/restaurant/ask-milton-catalog";
import { detectIntent } from "@/lib/restaurant/ask-milton-prompt";

const ing = (id: string, name: string, cost: number | null, unit = "lb") =>
  ({
    id,
    name,
    category: null,
    default_unit: unit,
    latest:
      cost === null
        ? null
        : {
            id: `e${id}`,
            normalized_unit_cost: cost,
            normalized_unit: unit,
            cost_date: "2026-07-01",
            currency: "USD",
            source_type: "manual",
            supplier_id: null,
            supplier_name: "Prov",
            source: "factura",
            previous_unit_cost: null,
          },
  }) as never;

describe("ingredient prices", () => {
  const rows = [
    ing("1", "Pellejo", 5.7),
    ing("2", "Sal", null),
    ing("3", "Carne molida", 2.2),
    ing("4", "Cero", 0),
  ];
  it("ranks by price, keeps Sin precio out (never $0) and counts it", () => {
    const p = buildIngredientPrices({
      rows,
      dishCount: new Map([["1", 3]]),
      dishNames: new Map([["1", ["Tripa", "Chorizo"]]]),
      inUse: new Set(["2"]),
      scope: "company",
    });
    expect(p.top_by_unit_cost.map((i) => i.name)).toEqual([
      "Pellejo",
      "Carne molida",
    ]);
    expect(p.top_by_unit_cost[0]).toMatchObject({
      price: 5.7,
      unit: "lb",
      source: "factura",
      supplier_name: "Prov",
      dishes_using: 3,
      used_in: ["Tripa", "Chorizo"],
    });
    expect(p.unpriced_count).toBe(2);
    expect(p.unpriced_in_use).toEqual(["Sal"]);
    expect(JSON.stringify(p)).not.toContain('"price":0');
  });
  it("is capped", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      ing(`${i}`, `I${i}`, i + 1)
    );
    expect(
      buildIngredientPrices({
        rows: many,
        dishCount: null,
        dishNames: null,
        inUse: null,
        scope: "restaurant",
      }).top_by_unit_cost
    ).toHaveLength(15);
  });
});

describe("menu dishes and groups", () => {
  const dish = (name: string, category: string, net: number, pid: number) =>
    ({
      name,
      category,
      net_sales: net,
      units: 2,
      food_cost_pct: null,
      margin_pct: null,
      cost_status: "falta_precio",
      variants: [{ odoo_product_id: pid, net_sales: net, units: 2 }],
    }) as never;
  const econ = {
    currency: "USD",
    period: { from: "2026-07-01", to: "2026-07-31" },
    menu_dishes: [
      dish("A", "Churrascos", 100, 1),
      dish("B", "Churrascos", 50, 2),
      dish("C", "Bebidas", 70, 3),
    ],
    dishes: [],
    item_groups: {
      available: true,
      groups: [
        { id: "g", name: "Carnes", scope: "product", status: "confirmed" },
      ],
      members: [
        {
          id: "m1",
          group_id: "g",
          member_type: "pos_product",
          member_ref: "1",
        },
        {
          id: "m2",
          group_id: "g",
          member_type: "pos_product",
          member_ref: "3",
        },
      ],
    },
  } as never;
  it("sales by category and by group, null cost stays null", () => {
    const m = buildMenuDishes(econ);
    expect(m.sales_by_category[0]).toMatchObject({
      category: "Churrascos",
      net_sales: 150,
      dishes: 2,
    });
    expect(m.top_by_sales[0].food_cost_pct).toBeNull();
    expect(buildItemGroups(econ)).toEqual([
      { name: "Carnes", products: 2, net_sales: 170, units: 4 },
    ]);
  });
});

describe("Spanish intent", () => {
  it("«¿Qué ingredientes salen más caros?» is the expensive-ingredients question", () => {
    expect(detectIntent("¿Qué ingredientes salen más caros?")).toBe(
      "expensive_ingredients"
    );
  });
});

describe("grounding", () => {
  it("a model answer that says there is no data is replaced by the real ranking", async () => {
    const { groundAskMiltonAnswer } =
      await import("@/lib/restaurant/ask-milton-ground");
    const { EMPTY_INGREDIENT_PRICES } =
      await import("@/lib/restaurant/ask-milton-catalog");
    const ctx = {
      briefing: { currency: "USD", preferred_language: "es" },
      ingredient_prices: {
        ...EMPTY_INGREDIENT_PRICES,
        priced_count: 1,
        unpriced_count: 3,
        top_by_unit_cost: [
          {
            name: "Pellejo",
            category: null,
            price: 5.7,
            unit: "lb",
            currency: "USD",
            price_date: "2026-07-01",
            source: "factura",
            supplier_name: null,
            dishes_using: 2,
            used_in: ["Tripa"],
          },
        ],
      },
      expensive_ingredients: [],
      ingredient_usage: [],
    } as never;
    const ai = {
      answer: "No tengo datos sobre ingredientes caros.",
      supporting_facts: [],
      related_links: [],
      suggested_followups: [],
      confidence_notes: [],
    };
    const out = groundAskMiltonAnswer(
      ai,
      ctx,
      "¿Qué ingredientes salen más caros?",
      "expensive_ingredients",
      { resolved_ingredients: [], resolved_menu_items: [] } as never
    );
    expect(out.replaced).toBe(true);
    expect(out.answer.answer).toContain("Pellejo");
    expect(out.answer.answer).toContain("Sin precio");
    expect(out.answer.answer).not.toContain("$0");
  });
});
