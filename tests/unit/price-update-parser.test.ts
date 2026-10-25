import { describe, it, expect } from "vitest";
import {
  parsePriceUpdate,
  formatPriceUpdateItems,
  PRICE_UPDATE_MAX_ITEMS,
} from "@/lib/restaurant/telegram/price-update";

type Item = { name: string; price: number; unit: string };
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
    expect(parsePriceUpdate(text)).toEqual(upd(items));
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

  it("caps the number of items", () => {
    const text = Array.from(
      { length: 14 },
      (_, i) => `item${"abcdefghijklmn"[i]} 1.50 la libra`
    )
      .join(", ")
      .replace(/item/g, "prod");
    const r = parsePriceUpdate(text);
    expect(r?.kind).toBe("price_update");
    if (r?.kind === "price_update") {
      expect(r.items.length).toBe(PRICE_UPDATE_MAX_ITEMS);
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
