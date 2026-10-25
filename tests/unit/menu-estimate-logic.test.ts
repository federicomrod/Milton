import { describe, expect, it } from "vitest";
import {
  canEstimate,
  estimatedDishCost,
  estimatedMargin,
  estimatePrompt,
  nameKeyOf,
  parseEstimate,
  priceEstimateLines,
  type EstimateLineRaw,
  type EstimatedLine,
} from "@/lib/restaurant/menu-reading/estimate";
import {
  buildDishFacts,
  dishEligibility,
} from "@/lib/restaurant/menu-reading/estimate-server";
import { hasRecipe } from "@/lib/restaurant/recipe-costing/has-recipe";
import {
  dishStateFrom,
  pickDishVersions,
} from "@/lib/restaurant/costing/dish-state";
import { htmlToText } from "@/lib/restaurant/menu-reading/html-text";
import { parseMenuDishes } from "@/lib/restaurant/menu-reading/extract";

const line = (over: Record<string, unknown> = {}) => ({
  raw_name: "salmón",
  qty: 120,
  unit: "g",
  price_per_unit: 12,
  price_unit: "lb",
  confidence: "media",
  ...over,
});

describe("parseEstimate", () => {
  it("accepts a valid answer", () => {
    const r = parseEstimate({ lines: [line()], portion_note: " 1 plato " });
    expect(r?.lines).toHaveLength(1);
    expect(r?.portion_note).toBe("1 plato");
  });
  it("drops zero, negative, NaN, unknown unit and over-limit lines", () => {
    const r = parseEstimate({
      lines: [
        line({ raw_name: "ok" }),
        line({ qty: 0 }),
        line({ qty: -5 }),
        line({ qty: Number.NaN }),
        line({ qty: "abc" }),
        line({ unit: "taza" }),
        line({ qty: 5000 }),
        line({ unit: "lb", qty: 11 }),
        line({ raw_name: "" }),
      ],
    });
    expect(r?.lines.map((l) => l.raw_name)).toEqual(["ok"]);
  });
  it("never turns a bad price into 0", () => {
    const r = parseEstimate({
      lines: [
        line({ raw_name: "a", price_per_unit: 0 }),
        line({ raw_name: "b", price_per_unit: -1 }),
        line({ raw_name: "c", price_unit: "taza" }),
        line({ raw_name: "d", price_per_unit: null }),
      ],
    });
    expect(r?.lines).toHaveLength(4);
    for (const l of r!.lines) {
      expect(l.price_per_unit).toBeNull();
      expect(l.price_unit).toBeNull();
    }
  });
  it("returns null with no valid line, more than 25 lines or bad JSON", () => {
    expect(parseEstimate({ lines: [line({ qty: 0 })] })).toBeNull();
    expect(
      parseEstimate({ lines: Array.from({ length: 26 }, () => line()) })
    ).toBeNull();
    expect(parseEstimate("no json")).toBeNull();
    expect(parseEstimate(null)).toBeNull();
    expect(parseEstimate(JSON.stringify({ lines: [line()] }))).not.toBeNull();
  });
});

describe("priceEstimateLines", () => {
  const raw = (over: Partial<EstimateLineRaw> = {}): EstimateLineRaw => ({
    raw_name: "Salmón",
    qty: 100,
    unit: "g",
    price_per_unit: null,
    price_unit: null,
    confidence: "alta",
    ...over,
  });
  const noEst = () => null;

  it("real price wins over the estimate", () => {
    const [l] = priceEstimateLines(
      [raw()],
      () => ({ unit_cost: 0.02, unit: "g" }),
      () => ({ unit_price: 0.5, unit: "g", id: "e1" })
    );
    expect(l.price_source).toBe("real");
    expect(l.line_cost).toBeCloseTo(2);
    expect(l.price_estimate_id).toBeNull();
  });
  it("uses the cached estimate (with its id) when there is no real price", () => {
    const seen: string[] = [];
    const [l] = priceEstimateLines(
      [raw()],
      () => null,
      (key) => {
        seen.push(key);
        return { unit_price: 0.03, unit: "g", id: "e1" };
      }
    );
    expect(seen).toEqual(["salmon"]);
    expect(l.price_source).toBe("estimado");
    expect(l.price_estimate_id).toBe("e1");
    expect(l.line_cost).toBeCloseTo(3);
  });
  it("falls back to the model's own price", () => {
    const [l] = priceEstimateLines(
      [raw({ price_per_unit: 10, price_unit: "lb" })],
      () => null,
      noEst
    );
    expect(l.price_source).toBe("estimado");
    expect(l.line_cost).toBeCloseTo((100 / 453.59237) * 10, 3);
  });
  it("converts g quantity against a lb price and oz against kg", () => {
    const [a, b] = priceEstimateLines(
      [raw({ qty: 453.59237 }), raw({ qty: 1, unit: "oz" })],
      (l) => ({
        unit_cost: l.unit === "g" ? 4 : 10,
        unit: l.unit === "g" ? "lb" : "kg",
      }),
      noEst
    );
    expect(a.line_cost).toBeCloseTo(4, 3);
    expect(b.line_cost).toBeCloseTo(0.2835, 3);
  });
  it("no price gives null cost, never 0", () => {
    const [l] = priceEstimateLines([raw()], () => null, noEst);
    expect(l.price_source).toBeNull();
    expect(l.line_cost).toBeNull();
  });
  it("a unit that cannot be converted gives null cost", () => {
    const [l] = priceEstimateLines(
      [raw({ unit: "unidad", qty: 2 })],
      () => ({ unit_cost: 1, unit: "kg" }),
      noEst
    );
    expect(l.price_source).toBe("real");
    expect(l.line_cost).toBeNull();
  });
  it("an ingredient conversion can bridge units", () => {
    const [l] = priceEstimateLines(
      [raw({ unit: "unidad", qty: 2 })],
      () => ({ unit_cost: 0.01, unit: "g" }),
      noEst,
      { conversions: [{ from_unit: "unidad", to_unit: "g", factor: 50 }] }
    );
    expect(l.line_cost).toBeCloseTo(1);
  });
});

describe("estimatedDishCost / estimatedMargin", () => {
  const el = (cost: number | null): EstimatedLine => ({
    raw_name: "x",
    ingredient_id: null,
    qty: 1,
    unit: "g",
    price_source: cost == null ? null : "estimado",
    unit_price: null,
    price_unit: null,
    price_estimate_id: null,
    line_cost: cost,
    confidence: null,
  });
  it("sums only when every line has a cost", () => {
    expect(estimatedDishCost([el(1.5), el(2)])).toBe(3.5);
    expect(estimatedDishCost([el(1.5), el(null)])).toBeNull();
    expect(estimatedDishCost([el(1.5), el(0)])).toBeNull();
    expect(estimatedDishCost([])).toBeNull();
  });
  it("margin uses the given net price", () => {
    expect(estimatedMargin(3.76, 10)).toBeCloseTo(62.4);
    expect(estimatedMargin(12, 10)).toBeCloseTo(-20);
    expect(estimatedMargin(null, 10)).toBeNull();
    expect(estimatedMargin(3, null)).toBeNull();
    expect(estimatedMargin(3, 0)).toBeNull();
    expect(estimatedMargin(3, -4)).toBeNull();
  });
});

describe("canEstimate", () => {
  const base = { link_state: null, has_recipe: false, is_menu_draft: false };
  it("allows no-recipe and menu-draft dishes", () => {
    expect(canEstimate(base)).toEqual({ ok: true });
    expect(canEstimate({ ...base, link_state: "sugerido" })).toEqual({
      ok: true,
    });
    expect(
      canEstimate({ ...base, has_recipe: true, is_menu_draft: true })
    ).toEqual({ ok: true });
  });
  it("a Confirmado link does not block: it only says which product the plato is", () => {
    expect(canEstimate({ ...base, link_state: "confirmado" })).toEqual({
      ok: true,
    });
  });
  it("refuses approved and Excel or hand-made recipes", () => {
    expect(
      canEstimate({
        ...base,
        has_recipe: true,
        is_menu_draft: true,
        has_approved_version: true,
      })
    ).toEqual({ ok: false, reason: "approved" });
    expect(canEstimate({ ...base, has_recipe: true })).toEqual({
      ok: false,
      reason: "has_recipe",
    });
  });
});

describe("dishEligibility / buildDishFacts", () => {
  const link = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    odoo_product_id: 1,
    odoo_name: "Plato Demo",
    location_id: null,
    menu_item_id: "m1",
    link_state: "confirmado",
    evidence: {},
    ...over,
  });
  const facts = (
    versions: Array<Record<string, unknown>>,
    lineCounts: Record<string, number> = {},
    over: Record<string, unknown> = {}
  ) =>
    buildDishFacts(
      [link(over)] as never,
      versions.map((v) => ({ menu_item_id: "m1", ...v })) as never,
      null,
      new Map(Object.entries(lineCounts))
    )[0];

  it("ok for a Confirmado link with no recipe at all", () => {
    expect(dishEligibility(facts([]))).toEqual({ ok: true });
  });
  it("ok for an empty version; not ok once the version has lines", () => {
    const v = [{ id: "v1", status: "in_review", version_number: 1 }];
    expect(dishEligibility(facts(v))).toEqual({ ok: true });
    expect(dishEligibility(facts(v, { v1: 2 }))).toEqual({
      ok: false,
      reason: "has_recipe",
    });
  });
  it("an approved recipe with lines blocks; an approved one with none does not", () => {
    const v = [{ id: "v1", status: "approved", version_number: 1 }];
    expect(dishEligibility(facts(v))).toEqual({ ok: true });
    expect(dishEligibility(facts(v, { v1: 1 }))).toEqual({
      ok: false,
      reason: "approved",
    });
  });
});

describe("hasRecipe agrees with «Sin receta» in Menú › Platos", () => {
  const cases: Array<{
    name: string;
    versions: Array<{
      id: string;
      status: string;
      version_number: number;
      effective_date: string | null;
    }>;
    lines: Record<string, number>;
  }> = [
    { name: "no version", versions: [], lines: {} },
    {
      name: "empty version",
      versions: [
        {
          id: "a",
          status: "in_review",
          version_number: 1,
          effective_date: null,
        },
      ],
      lines: {},
    },
    {
      name: "rejected version",
      versions: [
        {
          id: "a",
          status: "rejected",
          version_number: 1,
          effective_date: null,
        },
      ],
      lines: { a: 3 },
    },
    {
      name: "approved with lines",
      versions: [
        {
          id: "a",
          status: "approved",
          version_number: 1,
          effective_date: null,
        },
      ],
      lines: { a: 3 },
    },
    {
      name: "draft with lines",
      versions: [
        {
          id: "a",
          status: "in_review",
          version_number: 1,
          effective_date: null,
        },
      ],
      lines: { a: 2 },
    },
    {
      name: "approved empty, newer draft with lines",
      versions: [
        {
          id: "a",
          status: "approved",
          version_number: 1,
          effective_date: null,
        },
        {
          id: "b",
          status: "in_review",
          version_number: 2,
          effective_date: null,
        },
      ],
      lines: { b: 2 },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const lineCounts = new Map(Object.entries(c.lines));
      const mine = hasRecipe({ versions: c.versions, lineCounts });
      // Platos: the version it is costed with, and its lines.
      const live = c.versions.filter((v) => v.status !== "rejected");
      const { version } = pickDishVersions(live);
      const state = dishStateFrom({
        has_version: version !== null,
        line_count: version ? (lineCounts.get(version.id) ?? 0) : 0,
        missing: 0,
        total: 1,
        approved: false,
        confirmed: true,
        treatment: "plato_preparado",
        in_food_sales: true,
        avg_net_price: 10,
      });
      expect(mine).toBe(state.status !== "sin_receta");
    });
  }
  it("a bound Excel suggestion counts as a recipe", () => {
    expect(
      hasRecipe({ versions: [], lineCounts: new Map(), boundSuggestion: true })
    ).toBe(true);
  });
});

describe("estimatePrompt", () => {
  const dish = {
    name: "Poke de salmón",
    section: "Bowls",
    description: "Salmón, arroz y aguacate",
    components: ["salmón", "arroz"],
    menu_price: 11.5,
    image_url: null,
  };
  it("includes country, currency, catalog names and the dish", () => {
    const { system, user } = estimatePrompt(dish, {
      country: "El Salvador",
      currency: "USD",
      catalogNames: [{ name: "Arroz sushi", unit: "kg" }],
    });
    expect(user).toContain("El Salvador");
    expect(user).toContain("USD");
    expect(user).toContain("Arroz sushi (kg)");
    expect(user).toContain("Poke de salmón");
    expect(user).toContain("11.5");
    expect(system).toContain("JSON");
  });
  it("without menu text it gives the name, the section and the average POS price only", () => {
    const { user } = estimatePrompt(
      {
        name: "Plato Demo",
        section: null,
        description: null,
        components: [],
        menu_price: null,
        pos_price: 18.5,
        image_url: null,
      },
      { country: "SV", currency: "USD", catalogNames: [] }
    );
    expect(user).toContain("Plato: Plato Demo");
    expect(user).toContain("Precio de venta promedio en el POS: 18.5");
    expect(user).not.toContain("Lleva (según el menú)");
    expect(user).not.toContain("Precio en el menú");
  });
  it("says país desconocido when the country is unknown", () => {
    const { user } = estimatePrompt(dish, {
      country: null,
      currency: "USD",
      catalogNames: [],
    });
    expect(user).toContain("país desconocido");
  });
  it("nameKeyOf strips accents", () => {
    expect(nameKeyOf("  Salmón  Fresco ")).toBe("salmon fresco");
  });
});

describe("htmlToText photos", () => {
  const base = "https://menu.example.com/carta/";
  it("keeps photos as their own line with absolute URLs", () => {
    const text = htmlToText(
      `<div><img src="/img/poke.jpg" alt="Poke de salmón"><h3>Poke de salmón</h3>
       <img src='hamb.png' alt="Hamburguesa | clásica"><img src="https://cdn.example.com/a.webp"></div>`,
      base
    );
    expect(text).toContain(
      "[imagen: https://menu.example.com/img/poke.jpg | Poke de salmón]"
    );
    expect(text).toContain(
      "[imagen: https://menu.example.com/carta/hamb.png | Hamburguesa clásica]"
    );
    expect(text).toContain("[imagen: https://cdn.example.com/a.webp | ]");
    expect(text.split("\n")[0].startsWith("[imagen:")).toBe(true);
  });
  it("skips data:, svg, http, pixels, trackers and logos", () => {
    const text = htmlToText(
      `<img src="data:image/png;base64,AAAA">
       <img src="/a.svg" alt="x">
       <img src="http://menu.example.com/plain.jpg">
       <img src="/p.gif" width="1" height="1">
       <img src="/p2.gif" height="2">
       <img src="/tracking-pixel.png">
       <img src="/spacer.gif">
       <img src="/img/logo.png">
       <img src="/img/x.png" alt="Icono de picante">
       <img src="/img/sprite.png"><img src="/img/avatar.png"><img src="/badge.png">
       <img src="/ok.jpg" alt="Plato">`,
      base
    );
    expect(text).toBe("[imagen: https://menu.example.com/ok.jpg | Plato]");
  });
  it("uses data-src when src is a placeholder", () => {
    const text = htmlToText(
      `<img src="data:image/gif;base64,R0lG" data-src="/lazy.jpg" alt="Lazy">`,
      base
    );
    expect(text).toBe("[imagen: https://menu.example.com/lazy.jpg | Lazy]");
  });
  it("caps the number of photos at 60", () => {
    const html = Array.from(
      { length: 90 },
      (_, i) => `<img src="/f/${i}.jpg">`
    ).join("");
    expect(htmlToText(html, base).split("\n")).toHaveLength(60);
  });
  it("without a base URL, relative photos are dropped and text is unchanged", () => {
    expect(htmlToText(`<p>Hola</p><img src="/a.jpg">`)).toBe("Hola");
  });
});

describe("parseMenuDishes image_url", () => {
  const dish = (image_url?: unknown) => ({
    dishes: [{ name: "Hamburguesa clásica", image_url }],
  });
  it("accepts https and rejects everything else", () => {
    expect(
      parseMenuDishes(dish("https://a.example.com/h.jpg"))[0].image_url
    ).toBe("https://a.example.com/h.jpg");
    for (const bad of [
      "http://a.example.com/h.jpg",
      "javascript:alert(1)",
      "https://a.example.com/" + "x".repeat(500),
      "not a url",
      "",
      42,
      null,
    ]) {
      expect(parseMenuDishes(dish(bad))[0].image_url).toBeNull();
    }
    expect(parseMenuDishes(dish())[0].image_url).toBeNull();
  });
});
