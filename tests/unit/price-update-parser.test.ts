import { describe, it, expect } from "vitest";
import {
  parsePriceUpdate,
  parsePriceMessage,
  parseUnitAnswer,
  looksLikePriceIntent,
  formatPriceUpdateItems,
  normalizeSpokenPrices,
  parsePriceItems,
  PRICE_UPDATE_MAX_ITEMS,
  parseAmountAnswer,
  extractNumberTokens,
  currencyCodeFromText,
  currencySymbolFor,
} from "@/lib/restaurant/telegram/price-update";

type Item = {
  name: string;
  price: number;
  unit: string;
  currency?: string | null;
};
// A dollar word («dólares», «USD», «75 centavos») now travels as currency USD
// on the item; a bare «$» says no ISO code.
const saidUsd = (text: string) =>
  /d[oó]lar|\busd\b|centavos/i.test(text) ? { currency: "USD" } : {};
const upd = (items: Item[]) => ({ kind: "price_update", items });
const UNCLEAR = { kind: "price_intent_unclear" };

const positives: Array<[string, Item[]]> = [
  [
    "el aguacate subió a 1.50 la libra",
    [{ name: "aguacate", price: 1.5, unit: "lb" }],
  ],
  [
    "El Aguacate SUBIO a $1.50 la libra",
    [{ name: "aguacate", price: 1.5, unit: "lb" }],
  ],
  ["aguacate 1.50 la libra", [{ name: "aguacate", price: 1.5, unit: "lb" }]],
  ["aguacate a 1.50 la libra", [{ name: "aguacate", price: 1.5, unit: "lb" }]],
  [
    "el tomate bajó a 0.80 por libra",
    [{ name: "tomate", price: 0.8, unit: "lb" }],
  ],
  [
    "pollo ahora está a 2,50 el kilo",
    [{ name: "pollo", price: 2.5, unit: "kg" }],
  ],
  [
    "ahora el pollo está en 2.5 el kg",
    [{ name: "pollo", price: 2.5, unit: "kg" }],
  ],
  ["la cebolla cuesta 0.45 lb", [{ name: "cebolla", price: 0.45, unit: "lb" }]],
  [
    "precio de aguacate a 1.50 la libra",
    [{ name: "aguacate", price: 1.5, unit: "lb" }],
  ],
  [
    "el precio del tomate a 0,80 la libra",
    [{ name: "tomate", price: 0.8, unit: "lb" }],
  ],
  ["aguacate $1.50/lb", [{ name: "aguacate", price: 1.5, unit: "lb" }]],
  [
    "el aguacate está a 1.50 dólares la libra",
    [{ name: "aguacate", price: 1.5, unit: "lb" }],
  ],
  [
    "el limón subió a 3 la docena",
    [{ name: "limón", price: 3, unit: "docena" }],
  ],
  [
    "la leche cuesta 1.10 el litro",
    [{ name: "leche", price: 1.1, unit: "litro" }],
  ],
  [
    "el aceite está a 12 el galón",
    [{ name: "aceite", price: 12, unit: "galón" }],
  ],
  [
    "el huevo cuesta 0.20 la unidad",
    [{ name: "huevo", price: 0.2, unit: "unidad" }],
  ],
  [
    "el tomate cuesta 20 la caja",
    [{ name: "tomate", price: 20, unit: "caja" }],
  ],
  [
    "la lechuga cuesta 0.9 la pieza",
    [{ name: "lechuga", price: 0.9, unit: "pieza" }],
  ],
  [
    "tomate subió a 0.80 la libra y cebolla a 0.45 el kilo",
    [
      { name: "tomate", price: 0.8, unit: "lb" },
      { name: "cebolla", price: 0.45, unit: "kg" },
    ],
  ],
  [
    "tomate 0.80 la libra, cebolla 0.45 la libra, aguacate 1.5 la libra",
    [
      { name: "tomate", price: 0.8, unit: "lb" },
      { name: "cebolla", price: 0.45, unit: "lb" },
      { name: "aguacate", price: 1.5, unit: "lb" },
    ],
  ],
  [
    "   el   aguacate   subió   a   1.5   la   libra  ",
    [{ name: "aguacate", price: 1.5, unit: "lb" }],
  ],
];

const negatives = [
  "se acabó el aguacate",
  "quedan 3 porciones",
  "llegaron 5 cajas de tomate",
  "merma de 2 libras de pollo",
  "86 el aguacate",
  "receta de tinga: 2 libras de pollo, 1 cebolla",
  "tinga 3x",
  "500 g de pollo",
  "2 x 1 kg",
  "reunión a las 3:30",
  "nos vemos el 12/05/2026",
  "llámame al 7777-1234",
  "hola buenos días",
  "pollo 2 lb",
  "",
  "   ",
];

const unclear = [
  "el aguacate subió",
  "cuánto es el precio del aguacate?",
  "el aguacate subió a 1.50",
  "el aguacate está a 1.50",
  "aguacate $1.50",
  "el aguacate subió a 1,500 la libra",
  "el aguacate subió a 1.500 la libra",
  "el aguacate subió a 0 la libra",
  "el aguacate subió a 999999 la libra",
  "tomate subió a 0.80 la libra y cebolla bajó",
  "tomate subió a 0.80 la libra y cebolla a $0.45",
  "subió a 1.50 la libra",
];

describe("parsePriceUpdate", () => {
  it.each(positives)("positive: %s", (text, items) => {
    expect(parsePriceUpdate(text)).toEqual(
      upd(items.map((i) => ({ ...i, ...saidUsd(text) })))
    );
  });

  it.each(negatives)("negative (null): %j", (text) => {
    expect(parsePriceUpdate(text)).toBeNull();
  });

  it.each(unclear)("unclear: %s", (text) => {
    expect(parsePriceUpdate(text)).toEqual(UNCLEAR);
  });

  it("treats 1,50 as 1.5 and never as 1500", () => {
    const r = parsePriceUpdate("aguacate 1,50 la libra");
    expect(r).toEqual(upd([{ name: "aguacate", price: 1.5, unit: "lb" }]));
  });

  it("caps the number of items at 25", () => {
    const text = Array.from(
      { length: 30 },
      (_, i) =>
        `prod${String.fromCharCode(97 + (i % 26))}${i < 26 ? "" : "x"} 1.50 la libra`
    ).join(", ");
    const r = parsePriceUpdate(text);
    expect(r?.kind).toBe("price_update");
    if (r?.kind === "price_update") {
      expect(r.items.length).toBe(PRICE_UPDATE_MAX_ITEMS);
      expect(PRICE_UPDATE_MAX_ITEMS).toBe(25);
    }
  });

  it("never returns price 0 or NaN and is deterministic", () => {
    const all = [...positives.map((p) => p[0]), ...negatives, ...unclear];
    for (const t of all) {
      const a = parsePriceUpdate(t);
      const b = parsePriceUpdate(t);
      expect(a).toEqual(b);
      if (a?.kind === "price_update") {
        for (const i of a.items) {
          expect(Number.isFinite(i.price)).toBe(true);
          expect(i.price).toBeGreaterThan(0);
          expect(i.price).toBeLessThanOrEqual(100000);
          expect(i.unit).not.toBe("");
          expect(i.name).not.toBe("");
        }
      }
    }
  });
});

describe("formatPriceUpdateItems", () => {
  it("renders plain two-decimal copy", () => {
    expect(
      formatPriceUpdateItems([
        { name: "aguacate", price: 1.5, unit: "lb" },
        { name: "tomate", price: 0.8, unit: "lb" },
      ])
    ).toBe("aguacate $1.50 la libra, tomate $0.80 la libra");
  });
});

describe("typos, abbreviations and spoken prices", () => {
  const one = (text: string): Item[] | null => {
    const r = parsePriceUpdate(text);
    return r?.kind === "price_update" ? r.items : null;
  };

  it.each([
    ["Aguacate 1,50 la onzs", { name: "aguacate", price: 1.5, unit: "oz" }],
    ["aguacate 1.50 la onz", { name: "aguacate", price: 1.5, unit: "oz" }],
    ["aguacate 1.50 la onza", { name: "aguacate", price: 1.5, unit: "oz" }],
    ["aguacate 1.50 por onzas", { name: "aguacate", price: 1.5, unit: "oz" }],
    ["aguacate $1.50 la oz.", { name: "aguacate", price: 1.5, unit: "oz" }],
    ["aguacate $1.50 la lbs.", { name: "aguacate", price: 1.5, unit: "lb" }],
    ["aguacate $1.50 el kg.", { name: "aguacate", price: 1.5, unit: "kg" }],
    ["leche 1.10 el lt", { name: "leche", price: 1.1, unit: "litro" }],
    ["leche 1.10 el litros", { name: "leche", price: 1.1, unit: "litro" }],
    ["sal 0.05 el gr", { name: "sal", price: 0.05, unit: "g" }],
    ["sal 0.05 el gramo", { name: "sal", price: 0.05, unit: "g" }],
    ["huevo 0.20 c/u", { name: "huevo", price: 0.2, unit: "unidad" }],
    ["huevo 0.20 cada uno", { name: "huevo", price: 0.2, unit: "unidad" }],
    ["huevo 0.20 la unidad", { name: "huevo", price: 0.2, unit: "unidad" }],
    ["cebolla 2 dólares el kilo", { name: "cebolla", price: 2, unit: "kg" }],
    ["cebolla 2 dolares el kilo", { name: "cebolla", price: 2, unit: "kg" }],
    ["cebolla 2 USD el kilo", { name: "cebolla", price: 2, unit: "kg" }],
    ["cebolla 1 dólar la libra", { name: "cebolla", price: 1, unit: "lb" }],
    [
      "el tomate subió a $0,80 la lb",
      { name: "tomate", price: 0.8, unit: "lb" },
    ],
    ["tomate 1,5 la libra", { name: "tomate", price: 1.5, unit: "lb" }],
  ])("%s", (text, item) => {
    expect(one(text)).toEqual([{ ...item, ...saidUsd(text) }]);
  });

  it.each([
    ["el aguacate ahora está a un dólar cincuenta la libra", 1.5],
    ["el aguacate está a un dólar con cincuenta la libra", 1.5],
    ["el aguacate está a dos dólares con veinticinco la libra", 2.25],
    ["aguacate un dólar y medio la libra", 1.5],
    ["aguacate un dólar con treinta y cinco la libra", 1.35],
    ["aguacate tres dólares la libra", 3],
  ])("spoken: %s", (text, price) => {
    expect(one(text)).toEqual([
      { name: "aguacate", price, unit: "lb", ...saidUsd(text) },
    ]);
  });

  it("«un dólar cinco» is not 1.05", () => {
    expect(one("aguacate un dólar cinco la libra")).toBeNull();
  });

  it("1,500 and 1.500 stay unclear", () => {
    expect(parsePriceUpdate("aguacate 1,500 la onza")).toEqual(UNCLEAR);
  });
});

describe("parsePriceMessage (unit may be missing)", () => {
  it("a price without unit needs the unit", () => {
    expect(parsePriceMessage("queso 3.25")).toEqual({
      kind: "needs_unit",
      items: [{ name: "queso", price: 3.25 }],
    });
    expect(parsePriceMessage("el aguacate subió a $1.50")).toEqual({
      kind: "needs_unit",
      items: [{ name: "aguacate", price: 1.5 }],
    });
  });

  it("mixed with and without unit keeps what was read (partial)", () => {
    expect(parsePriceMessage("tomate 0.80 la libra y cebolla $0.45")).toEqual({
      kind: "partial",
      items: [{ name: "tomate", price: 0.8, unit: "lb" }],
      unitless: [{ name: "cebolla", price: 0.45 }],
      unclearCount: 0,
    });
  });

  it("quantities and reports are still not prices", () => {
    for (const t of negatives) expect(parsePriceMessage(t)).toBeNull();
  });
});

describe("signals", () => {
  it("looksLikePriceIntent", () => {
    for (const t of [
      "Aguacate 1,50 la onzs",
      "aguacate 1,5 x lbra",
      "el aguacate cuesta 1,5",
      "cebolla $1.2 el kilgramo",
      "queso 3.25",
    ]) {
      expect(looksLikePriceIntent(t), t).toBe(true);
    }
    for (const t of [
      "gracias por todo",
      "quedan 3 porciones",
      "llegaron 5 cajas de tomate",
      "86 el aguacate",
      "1 hamburguesa",
      "reunión a las 3:30",
      "nos vemos el 12/05/2026",
      "llámame al 7777-1234",
      "pollo 2 lb",
    ]) {
      expect(looksLikePriceIntent(t), t).toBe(false);
    }
  });

  it("parseUnitAnswer", () => {
    expect(parseUnitAnswer("libra")).toBe("lb");
    expect(parseUnitAnswer("Por libra.")).toBe("lb");
    expect(parseUnitAnswer("la onza")).toBe("oz");
    expect(parseUnitAnswer("onzs")).toBe("oz");
    expect(parseUnitAnswer("el kilo")).toBe("kg");
    expect(parseUnitAnswer("c/u")).toBe("unidad");
    expect(parseUnitAnswer("unidad")).toBe("unidad");
    expect(parseUnitAnswer("gracias")).toBeNull();
    expect(parseUnitAnswer("libra de queso a 3")).toBeNull();
  });
});

describe("spoken numbers in price position (Whisper writes them every way)", () => {
  const one = (text: string): Item[] | null => {
    const r = parsePriceUpdate(text);
    return r?.kind === "price_update" ? r.items : null;
  };

  it.each([
    ["Aguacate a uno cincuenta la onza.", 1.5, "oz"],
    ["Aguacate a uno cincuenta (la onza)", 1.5, "oz"],
    ["Aguacate, uno con cincuenta la libra.", 1.5, "lb"],
    ["el aguacate a un dólar con cincuenta la onza", 1.5, "oz"],
    ["Aguacate a 1 con 50 la onza.", 1.5, "oz"],
    ["aguacate 1,50 la onza", 1.5, "oz"],
    ["aguacate $1.50 la onza", 1.5, "oz"],
    ["aguacate 1.50 dólares la onza", 1.5, "oz"],
    ["aguacate dólar cincuenta la libra", 1.5, "lb"],
    ["frijoles a 75 centavos la libra", 0.75, "lb"],
    ["frijoles a setenta y cinco centavos la libra", 0.75, "lb"],
    ["chicharrón a tres cincuenta la libra", 3.5, "lb"],
    ["chicharrón tres cincuenta la libra", 3.5, "lb"],
    ["queso a cuatro veinticinco la libra", 4.25, "lb"],
    ["harina uno veinticinco la libra", 1.25, "lb"],
    ["queso a dos dólares la libra", 2, "lb"],
    ["queso a un dólar la libra", 1, "lb"],
    ["queso a diez dólares y medio la libra", 10.5, "lb"],
    ["queso a medio dólar la libra", 0.5, "lb"],
    ["queso a dos la libra", 2, "lb"],
  ])("%s", (text, price, unit) => {
    expect(one(text)).toEqual([
      { name: expect.any(String), price, unit, ...saidUsd(text) },
    ]);
  });

  it("normalizeSpokenPrices turns only price-position numbers into digits", () => {
    expect(normalizeSpokenPrices("aguacate a uno cincuenta la onza")).toBe(
      "aguacate a 1.50 la onza"
    );
    expect(normalizeSpokenPrices("a 75 centavos la libra")).toBe(
      "a 0.75 dólares la libra"
    );
    expect(normalizeSpokenPrices("un dólar cinco")).toBe("un dólar cinco");
  });

  it.each([
    "se usan dos libras de masa para las pupusas",
    "se usan 2 libras de masa para las pupusas",
    "necesito dos libras de masa",
    "6 tomates",
    "2 tazas de harina",
    "quedan tres cincuenta porciones",
    "llegaron cinco cajas de tomate",
    "nos vemos a las tres cincuenta",
  ])("quantities are never prices: %s", (text) => {
    expect(parsePriceItems(text)?.items ?? []).toEqual([]);
    expect(parsePriceItems(text)?.unitless ?? []).toEqual([]);
    expect(normalizeSpokenPrices(text)).toBe(text);
  });

  it("«aguacate a 150 la onza» is ambiguous: 150 is never saved or converted", () => {
    const r = parsePriceItems("Aguacate a 150 la onza.");
    expect(r?.items).toEqual([]);
    expect(r?.unclear).toEqual([
      expect.objectContaining({ label: "aguacate", hint: "150" }),
    ]);
    expect(normalizeSpokenPrices("aguacate a 150 la onza")).toBe(
      "aguacate a 150 la onza"
    );
    // An explicit currency removes the doubt.
    expect(one("aguacate a 150 dólares el quintal")).toEqual([
      { name: "aguacate", price: 150, unit: "quintal", currency: "USD" },
    ]);
  });
});

describe("parsePriceItems: item by item", () => {
  const text =
    "Precios para las pupusas revueltas. Masa de maíz a 75 centavos la libra, chicharrón a tres cincuenta la libra, quesillo a 4.25 la libra, frijoles a 1.20, aceite a 2.50 el litro. El agua tibia no tiene precio.";

  it("reads every item, asks the unit of one, skips the one without price", () => {
    const r = parsePriceItems(text);
    expect(r?.items).toEqual([
      { name: "masa de maíz", price: 0.75, unit: "lb", currency: "USD" },
      { name: "chicharrón", price: 3.5, unit: "lb" },
      { name: "quesillo", price: 4.25, unit: "lb" },
      { name: "aceite", price: 2.5, unit: "litro" },
    ]);
    expect(r?.unitless).toEqual([{ name: "frijoles", price: 1.2 }]);
    expect(r?.skippedNoPrice).toEqual(["agua tibia"]);
    expect(r?.unclear).toEqual([]);
  });

  it("the same list split by periods only (no commas)", () => {
    const r = parsePriceItems(
      text.replace(/, /g, ". ").replace("aceite", "Aceite")
    );
    expect(r?.items.length).toBe(4);
    expect(r?.unitless.length).toBe(1);
  });

  it("one unreadable item does not block the rest", () => {
    const r = parsePriceItems(
      "harina uno veinticinco la libra, chicharrón tres cincuenta la libra, sal (1,5) la libr, quesillo cuatro dólares la libra"
    );
    expect(r?.items.map((i) => i.name)).toEqual([
      "harina",
      "chicharrón",
      "quesillo",
    ]);
    expect(r?.unclear).toHaveLength(1);
  });

  it("an intro or a filler sentence does not block", () => {
    const r = parsePriceItems(
      "Estos son los precios. Aguacate a 1.50 la libra."
    );
    expect(r?.items).toEqual([{ name: "aguacate", price: 1.5, unit: "lb" }]);
    expect(r?.unclear).toEqual([]);
  });

  it("items run together without punctuation are still split", () => {
    const r = parsePriceItems(
      "masa a 0.75 la libra chicharrón a 3.50 la libra"
    );
    expect(r?.items).toHaveLength(2);
  });

  it("a missing price is skipped, never 0", () => {
    const r = parsePriceItems("El agua tibia no tiene precio.");
    expect(r).toMatchObject({
      items: [],
      unitless: [],
      unclear: [],
      skippedNoPrice: ["agua tibia"],
    });
  });
});

describe("currency per item (spec B)", () => {
  const items = (t: string) => parsePriceItems(t)?.items ?? [];

  it.each([
    ["aguacate a 150 pesos", 150, "MXN"],
    ["aguacate a 150 MXN", 150, "MXN"],
    ["aguacate a 150 colones el kilo", 150, "CRC"],
    ["aguacate a ₡150 el kilo", 150, "CRC"],
    ["aguacate a 150 quetzales la libra", 150, "GTQ"],
    ["aguacate a 150 lempiras la libra", 150, "HNL"],
    ["aguacate a 150 soles el kilo", 150, "PEN"],
    ["aguacate a 150 euros el kilo", 150, "EUR"],
    ["aguacate a €150 el kilo", 150, "EUR"],
    ["aguacate a 150 córdobas el kilo", 150, "NIO"],
    ["aguacate a 150 Pesos El Kilo", 150, "MXN"],
  ])("%s", (text, price, currency) => {
    const r = parsePriceItems(text);
    // without a unit the price is "unitless" (the bot asks the unit)
    const got = [...(r?.items ?? []), ...(r?.unitless ?? [])];
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: "aguacate", price, currency });
  });

  it("«el aguacate ahora está a 150 pesos el kilo» -> 150/kg MXN", () => {
    expect(items("el aguacate ahora está a 150 pesos el kilo")).toEqual([
      { name: "aguacate", price: 150, unit: "kg", currency: "MXN" },
    ]);
  });

  it("«Q150» (glued) is GTQ and the Q is not part of the name", () => {
    expect(items("aguacate Q150 la libra")).toEqual([
      { name: "aguacate", price: 150, unit: "lb", currency: "GTQ" },
    ]);
  });

  it("«q» as a word is never a currency", () => {
    expect(currencyCodeFromText("quiero 150 tomates, q pasa")).toBeNull();
    expect(currencyCodeFromText("aguacate Q150")).toBe("GTQ");
    expect(currencyCodeFromText("150 pesos")).toBe("MXN");
    expect(currencyCodeFromText("aguacate $1.50")).toBeNull();
    expect(currencyCodeFromText("3.50 dólares")).toBe("USD");
  });

  it("«el aguacate subió a 3.50 dólares la libra» -> 3.5/lb USD", () => {
    expect(items("el aguacate subió a 3.50 dólares la libra")).toEqual([
      { name: "aguacate", price: 3.5, unit: "lb", currency: "USD" },
    ]);
  });

  it("a message with no currency carries none (company currency applies)", () => {
    expect(items("aguacate 1.50 la libra")[0].currency).toBeUndefined();
    expect(items("aguacate $1.50 la libra")[0].currency).toBeUndefined();
  });

  it("currencySymbolFor knows the new codes", () => {
    expect(currencySymbolFor("USD")).toBe("$");
    expect(currencySymbolFor("GTQ")).toBe("Q");
    expect(currencySymbolFor("CRC")).toBe("₡");
    expect(currencySymbolFor("EUR")).toBe("€");
    expect(currencySymbolFor("HNL")).toBe("L");
    expect(currencySymbolFor("PEN")).toBe("S/");
    expect(currencySymbolFor("NIO")).toBe("C$");
    expect(currencySymbolFor(null)).toBe("$");
  });
});

describe("spoken hundreds (spec B)", () => {
  it("«ciento cincuenta», «doscientos» in price position", () => {
    expect(normalizeSpokenPrices("aguacate a ciento cincuenta dólares")).toBe(
      "aguacate a 150 dólares"
    );
    expect(normalizeSpokenPrices("aguacate a ciento cincuenta")).toBe(
      "aguacate a 150"
    );
    expect(normalizeSpokenPrices("aguacate doscientos pesos la libra")).toBe(
      "aguacate 200 pesos la libra"
    );
    expect(
      normalizeSpokenPrices("aguacate a doscientos treinta y cinco la libra")
    ).toBe("aguacate a 235 la libra");
  });

  it("quantities of hundreds are not touched", () => {
    const t = "quedan doscientos tomates";
    expect(normalizeSpokenPrices(t)).toBe(t);
  });

  it("«uno cincuenta» stays 1.50", () => {
    expect(normalizeSpokenPrices("aguacate a uno cincuenta la libra")).toBe(
      "aguacate a 1.50 la libra"
    );
  });

  it("«aguacate a ciento cincuenta dólares la libra» -> 150/lb", () => {
    expect(
      parsePriceItems("aguacate a ciento cincuenta dólares la libra")?.items
    ).toEqual([{ name: "aguacate", price: 150, unit: "lb", currency: "USD" }]);
  });
});

describe("copulas are not part of the name (spec G)", () => {
  it("«El precio del aguacate es de 150 dólares.» -> aguacate, needs a unit", () => {
    const r = parsePriceMessage("El precio del aguacate es de 150 dólares.");
    expect(r).toEqual({
      kind: "needs_unit",
      items: [{ name: "aguacate", price: 150, currency: "USD" }],
    });
  });

  it.each([
    ["el aguacate está a 1.50 la libra", "aguacate"],
    ["los tomates son 0.80 la libra", "tomates"],
    ["el pollo anda a 2.50 el kilo", "pollo"],
    ["la cebolla quedó en 0.45 la libra", "cebolla"],
    ["el aguacate ya está a 1.50 la libra", "aguacate"],
  ])("%s", (t, name) => {
    expect(parsePriceItems(t)?.items[0]?.name).toBe(name);
  });
});

describe("ambiguous 3-digit amounts (spec A)", () => {
  it("«aguacate a 150» -> ambiguous [1.5, 150], not dropped", () => {
    const r = parsePriceMessage("aguacate a 150");
    expect(r).toEqual({
      kind: "price_intent_unclear",
      ambiguous: [
        {
          product: "aguacate",
          options: [1.5, 150],
          unit: null,
          currency: null,
          segment: expect.any(String),
        },
      ],
    });
  });

  it("keeps the unit when it was said", () => {
    const r = parsePriceItems("Aguacate a 150 la libra.");
    expect(r?.items).toEqual([]);
    expect(r?.ambiguous).toEqual([
      expect.objectContaining({
        product: "aguacate",
        options: [1.5, 150],
        unit: "lb",
        currency: null,
      }),
    ]);
    // older callers still see it in `unclear` with the hint
    expect(r?.unclear).toEqual([
      expect.objectContaining({ label: "aguacate", hint: "150" }),
    ]);
  });

  it("an explicit currency is not ambiguous", () => {
    for (const t of [
      "aguacate a 150 dólares la libra",
      "aguacate a $150 la libra",
      "aguacate a 150 pesos el kilo",
    ]) {
      const r = parsePriceItems(t);
      expect(r?.ambiguous, t).toEqual([]);
      expect(r?.items.length, t).toBe(1);
    }
  });

  it("an ambiguous item does not hide the readable ones", () => {
    const r = parsePriceMessage("tomate 0.80 la libra, aguacate a 150");
    expect(r).toMatchObject({
      kind: "price_update",
      items: [{ name: "tomate", price: 0.8, unit: "lb" }],
      ambiguous: [{ product: "aguacate", options: [1.5, 150] }],
    });
  });

  it("«¿cuánto cuesta la pupusa?» is a question, not a malformed price", () => {
    expect(parsePriceMessage("¿cuánto cuesta la pupusa?")).toBeNull();
    expect(parsePriceUpdate("¿cuánto cuesta la pupusa?")).toBeNull();
  });
});

describe("parseAmountAnswer / extractNumberTokens", () => {
  it.each([
    ["1.50", 1.5],
    ["1,50", 1.5],
    ["150", 150],
    ["150.", 150],
    ["$150", 150],
    ["$150.", 150],
    ["$1.50", 1.5],
    ["uno cincuenta", 1.5],
    ["Uno cincuenta.", 1.5],
    ["uno con cincuenta", 1.5],
    ["ciento cincuenta", 150],
    ["Ciento cincuenta.", 150],
    ["doscientos", 200],
    ["150 dólares", 150],
    ["un dólar cincuenta", 1.5],
    ["es 1.50", 1.5],
  ])("answer %j -> %s", (t, v) => {
    expect(parseAmountAnswer(t)).toBe(v);
  });

  it.each([
    "gracias",
    "por libra",
    "aguacate a 150",
    "1.500",
    "7150-2233",
    "",
    "hola 150",
  ])("not an amount answer: %j", (t) => {
    expect(parseAmountAnswer(t)).toBeNull();
  });

  it("extractNumberTokens is decimal-aware", () => {
    expect(extractNumberTokens("aguacate a 1.50 la libra")).toEqual([1.5]);
    expect(extractNumberTokens("aguacate 1,50")).toEqual([1.5]);
    expect(extractNumberTokens("llámame al 7150-2233, aguacate 3.50")).toEqual([
      3.5,
    ]);
    expect(extractNumberTokens("a uno cincuenta la libra")).toEqual([1.5]);
    expect(extractNumberTokens("aguacate a 150, tomate 0.80")).toEqual([
      150, 0.8,
    ]);
    expect(extractNumberTokens("")).toEqual([]);
  });
});
