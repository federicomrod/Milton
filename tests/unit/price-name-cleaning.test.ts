// Item names lose buying verbs and vague quantities («compramos pan» -> «pan»),
// and products said without a price next to priced ones are found, not dropped.

import { describe, expect, it } from "vitest";
import {
  parsePriceItems,
  unpricedMentions,
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

describe("unpricedMentions", () => {
  it("finds the product that has no price beside one that has", () => {
    expect(unpricedMentions("pan a 2 dólares el kilo y unos tomates")).toEqual([
      "tomates",
    ]);
    expect(
      unpricedMentions("compramos pan a 2 dólares el kilo y tomates, cebollas")
    ).toEqual(["tomates", "cebollas"]);
  });

  it("is empty when nothing was priced, or nothing is left over", () => {
    expect(unpricedMentions("unos tomates")).toEqual([]);
    expect(unpricedMentions("compramos pan a 2 dólares el kilo")).toEqual([]);
    expect(unpricedMentions("tomates: 5")).toEqual([]);
  });

  it("ignores pleasantries and questions", () => {
    expect(
      unpricedMentions("pan a 2 dólares el kilo y por favor, gracias")
    ).toEqual([]);
    expect(unpricedMentions("pan a 2 dólares el kilo y ¿tomates?")).toEqual([]);
  });

  it("a quick-reply text («tomates: 5») is never read as a price", () => {
    expect(parsePriceItems("tomates: 5")?.items ?? []).toEqual([]);
    expect(parsePriceItems("tomates: 10")?.unitless ?? []).toEqual([]);
  });
});
