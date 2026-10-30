// Item names lose buying verbs and vague quantities («compramos pan» -> «pan»),
// and products said without a price next to priced ones are found, not dropped.

import { describe, expect, it } from "vitest";
import {
  parsePriceItems,
  purchaseMentions,
} from "@/lib/restaurant/telegram/price-update";

const names = (text: string) =>
  (parsePriceItems(text)?.items ?? []).map((i) => i.name);

describe("item names", () => {
  it.each([
    ["compramos pan a 2 dólares el kilo", ["pan"]],
    ["compré tomates a 1.50 la libra", ["tomates"]],
    ["hoy compramos pan, 3 dólares la libra", ["pan"]],
    ["pedimos unos tomates a 1.50 la libra", ["tomates"]],
    ["trajeron queso a 5 el kilo", ["queso"]],
    ["pan a 2 dólares el kilo", ["pan"]],
    ["queso fresco 4.50 la libra", ["queso fresco"]],
  ])("%s -> %j", (text, expected) => {
    expect(names(text)).toEqual(expected);
  });

  it("a name that is only a verb stays unread instead of becoming a product", () => {
    const r = parsePriceItems("compramos a 2 dólares el kilo");
    expect((r?.items ?? []).map((i) => i.name)).not.toContain("compramos");
  });
});

describe("purchaseMentions: nothing the cook said is dropped", () => {
  const names = (t: string) => purchaseMentions(t).lines.map((l) => l.name);

  it("finds the product that has no price beside one that has (also with «Hoy», a final period or «, y»)", () => {
    for (const t of [
      "pan a 2 dólares el kilo y unos tomates",
      "Hoy compramos pan a 2 dólares el kilo y unos tomates",
      "Hoy compramos pan a 2 dólares el kilo y unos tomates.",
      "hoy compramos pan a 2 dólares el kilo, y unos tomates",
    ]) {
      expect(names(t)).toEqual(["tomates"]);
    }
    expect(
      names("compramos pan a 2 dólares el kilo y tomates, cebollas")
    ).toEqual(["tomates", "cebollas"]);
  });

  it("«compramos 3 kg de harina» is a line with its quantity and unit, no price", () => {
    expect(purchaseMentions("compramos 3 kg de harina").lines).toEqual([
      { name: "harina", price: null, unit: "kg", quantity: 3 },
    ]);
    expect(purchaseMentions("pedimos dos libras de masa").lines).toEqual([
      { name: "masa", price: null, unit: "lb", quantity: 2 },
    ]);
    expect(purchaseMentions("compré 6 tomates").lines).toEqual([
      { name: "tomates", price: null, unit: "unidad", quantity: 6 },
    ]);
  });

  it("stock talk of the same message goes to the stock path, not to Compras", () => {
    const r = purchaseMentions("se acabó el queso y compramos 3 kg de harina");
    expect(r.lines.map((l) => l.name)).toEqual(["harina"]);
    expect(r.stockText).toBe("se acabó el queso");
  });

  it("is empty for messages that are not purchases", () => {
    for (const t of [
      "unos tomates",
      "tomates: 5",
      "se acabó el queso",
      "gracias por todo",
      "pan a 2 dólares el kilo",
      "¿cuánto cuesta la pupusa?",
    ]) {
      expect(names(t)).toEqual([]);
    }
  });

  it("ignores pleasantries and questions inside a purchase", () => {
    expect(names("pan a 2 dólares el kilo y por favor, gracias")).toEqual([]);
    expect(names("pan a 2 dólares el kilo y ¿tomates?")).toEqual([]);
  });

  it("a quick-reply-looking text («tomates: 5») is never read as a price", () => {
    expect(parsePriceItems("tomates: 5")?.items ?? []).toEqual([]);
    expect(parsePriceItems("tomates: 10")?.unitless ?? []).toEqual([]);
  });
});
